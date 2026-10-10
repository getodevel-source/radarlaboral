import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RadarDatabase } from './database'
import { registerIpc } from './ipc'
import { terminateOcrWorker } from './ocr'
import { syncWindowsBackgroundSchedule } from './background-schedule'
import { reportSearchCompletion, reportSearchFailure, type SearchCompletionCounts } from './search-notifications'
import { deliverDueFollowUpReminders, windowsToastSettingAllowsNotifications } from './follow-up-notifications'
import { configureWindowsNotificationIdentity } from './windows-notification-identity'
import { runSearch } from './search'
import { testPdfExportDirectoryFromArgs, userDataPathFromArgs } from './user-data-path.ts'
import { localDateString } from '../src/shared/local-date.ts'
import type { SearchRunResult } from '../src/shared/types'

const requireFile = fileURLToPath(import.meta.url)
const electronDirectory = path.dirname(requireFile)
const appRoot = path.join(electronDirectory, '..')
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const rendererDirectory = path.join(appRoot, 'dist')
const trayIconPath = path.join(appRoot, 'resources', 'tray.png')
const customUserDataPath = userDataPathFromArgs(process.argv)
const testPdfExportDirectory = testPdfExportDirectoryFromArgs(process.argv, customUserDataPath)
const backgroundRunArgument = '--radar-background-run'
const backgroundTaskLaunch = process.argv.includes(backgroundRunArgument)
configureWindowsNotificationIdentity(process.platform, app)
if (customUserDataPath) app.setPath('userData', customUserDataPath)
const appLock = app.requestSingleInstanceLock()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let database: RadarDatabase | null = null
let quitting = false
let maintenanceMode = false
let backgroundScheduleReady = false
let scheduledSearch: NodeJS.Timeout | null = null
let followUpReminderTimer: NodeJS.Timeout | null = null
let activeSearch: Promise<SearchRunResult> | null = null
let pendingSearchFailureCount = 0
let pendingSearchCompletionCounts: SearchCompletionCounts | null = null
let searchCompletionListenerReady = false
let searchFailureListenerReady = false
let followUpReminderDeliverySequence = 0
let followUpReminderListenerReady = false
const pendingFollowUpReminders: Array<{ deliveryId: string; count: number }> = []
const followUpReminderAcknowledgements = new Map<string, () => void>()

app.setName('Radar Laboral')
app.commandLine.appendSwitch('lang', 'es-AR')

if (!appLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes(backgroundRunArgument)) {
      void runSearchNow().catch(() => {})
      return
    }
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    createApplicationMenu()
    database = new RadarDatabase(app.getPath('userData'))
    const settings = database.settings()
    const startHidden = backgroundTaskLaunch && settings.backgroundSearchEnabled
    if (app.isPackaged && process.platform === 'win32') {
      if (!customUserDataPath) {
        try {
          app.setLoginItemSettings({ openAtLogin: false })
        } catch (error) {
          console.error('No se pudo retirar el inicio de sesión anterior:', error)
        }
      }
      if (startHidden) backgroundScheduleReady = true
      else {
        try {
          await updateBackgroundSchedule(settings.backgroundSearchEnabled, settings.searchIntervalHours)
        } catch (error) {
          backgroundScheduleReady = false
          notifyBackgroundScheduleError(error)
        }
      }
    }
    registerIpc(database, () => {
      startSearchTimer()
    }, () => runSearchNow(false), beginDataRestore, cancelDataRestore, testPdfExportDirectory, updateBackgroundSchedule)
    const trayReady = createTray()
    createWindow(!startHidden || !trayReady)
    startFollowUpReminderTimer()
    startSearchTimer()
    // Foreground search on open is intended even when the closed-app schedule
    // is off; backgroundSearchEnabled only governs the Windows task.
    void runSearchNow().catch(() => {})
  })
}

function createApplicationMenu() {
  const viewItems: Electron.MenuItemConstructorOptions[] = [
    { label: 'Recargar', role: 'reload' },
    { label: 'Recargar forzadamente', role: 'forceReload' },
    { type: 'separator' },
    { label: 'Tamaño real', role: 'resetZoom' },
    { label: 'Aumentar zoom', role: 'zoomIn' },
    { label: 'Reducir zoom', role: 'zoomOut' },
  ]
  if (devServerUrl) viewItems.push({ label: 'Herramientas de desarrollo', role: 'toggleDevTools' })

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'Archivo', submenu: [{ label: 'Salir', role: 'quit' }] },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' },
      ],
    },
    { label: 'Ver', submenu: viewItems },
    {
      label: 'Ventana',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Cerrar', role: 'close' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(showWhenReady = true) {
  followUpReminderListenerReady = false
  searchCompletionListenerReady = false
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    title: 'Radar Laboral',
    backgroundColor: '#f4f3ef',
    webPreferences: {
      preload: path.join(electronDirectory, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    if (showWhenReady) mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openHttpLink(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAppPage(navigationUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('did-start-loading', () => {
    followUpReminderListenerReady = false
    searchCompletionListenerReady = false
  })
  mainWindow.webContents.on('did-finish-load', () => {
    flushPendingSearchFailure()
    flushPendingSearchCompletionNotice()
    flushPendingFollowUpReminder()
  })
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    if (process.env.RADAR_OPEN_DEVTOOLS === 'true') mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(rendererDirectory, 'index.html'))
  }
}

function isAppPage(rawUrl: string) {
  try {
    const candidate = new URL(rawUrl)
    if (devServerUrl) {
      const developmentPage = new URL(devServerUrl)
      return candidate.origin === developmentPage.origin && candidate.pathname === developmentPage.pathname
    }
    return candidate.protocol === 'file:' && fileURLToPath(candidate) === path.join(rendererDirectory, 'index.html')
  } catch {
    return false
  }
}

async function openHttpLink(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'https:' || url.protocol === 'http:') await shell.openExternal(url.toString())
  } catch {
    // Untrusted or malformed links are ignored.
  }
}

function createTray() {
  if (!existsSync(trayIconPath)) return false
  const icon = nativeImage.createFromPath(trayIconPath)
  if (icon.isEmpty()) return false
  tray = new Tray(icon)
  tray.setToolTip('Radar Laboral · búsqueda en segundo plano')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Radar Laboral', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: 'Buscar vacantes ahora', click: () => { void runSearchNow().catch(() => {}) } },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
  tray.on('double-click', () => mainWindow?.show())
  return true
}

async function updateBackgroundSchedule(enabled: boolean, intervalHours: number) {
  if (!app.isPackaged || process.platform !== 'win32') {
    backgroundScheduleReady = false
    return
  }
  await syncWindowsBackgroundSchedule(enabled, app.getPath('exe'), intervalHours, customUserDataPath)
  backgroundScheduleReady = enabled
}

function notifyBackgroundScheduleError(error: unknown) {
  console.error('No se pudo configurar la búsqueda programada de Windows:', error)
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'No se pudo programar la búsqueda',
    body: 'Radar seguirá buscando mientras esté abierto. Revisá la opción de búsqueda en segundo plano en Preferencias.',
  })
  notification.show()
}

function startSearchTimer() {
  if (!database || maintenanceMode) return
  if (scheduledSearch) clearInterval(scheduledSearch)
  scheduledSearch = null
  const settings = database.settings()
  if (app.isPackaged && settings.backgroundSearchEnabled && backgroundScheduleReady) return
  const intervalMs = settings.searchIntervalHours * 60 * 60 * 1000
  scheduledSearch = setInterval(() => {
    void runSearchNow().catch(() => {})
  }, intervalMs)
}

function startFollowUpReminderTimer() {
  if (followUpReminderTimer) clearInterval(followUpReminderTimer)
  followUpReminderTimer = null
  if (!database || maintenanceMode) return
  checkDueFollowUps()
  followUpReminderTimer = setInterval(checkDueFollowUps, 30 * 60 * 1000)
}

function checkDueFollowUps() {
  if (!database || maintenanceMode) return
  try {
    deliverDueFollowUpReminders(database, localDateString(), {
      log: (error) => console.error('No se pudieron notificar los seguimientos pendientes:', error),
      isSupported: () => Notification.isSupported() && areWindowsToastNotificationsEnabled(),
      show: (notice, onClick, onShown, onFailure) => {
        const notification = new Notification(notice)
        notification.on('click', onClick)
        notification.once('show', onShown)
        notification.once('failed', (_event, error) => onFailure(error))
        notification.show()
      },
      onClick: showFollowUpReminderInApp,
      fallback: (count, onShown) => showFollowUpReminderInApp(count, onShown),
    })
  } catch (error) {
    console.error('No se pudieron revisar los seguimientos pendientes:', error)
  }
}

function areWindowsToastNotificationsEnabled() {
  if (process.platform !== 'win32') return true
  try {
    const registryOutput = execFileSync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
      '/v',
      'ToastEnabled',
    ], { encoding: 'utf8', windowsHide: true, timeout: 2_000 })
    return windowsToastSettingAllowsNotifications(registryOutput)
  } catch {
    return true
  }
}

function showFollowUpReminderInApp(count: number, onShown?: () => void): boolean {
  const window = mainWindow
  const ready = Boolean(window) && !window!.isDestroyed() && window!.webContents.isLoading() === false && followUpReminderListenerReady
  if (!ready) {
    // Keep a single pending delivery: ticks run every 30 minutes and the row
    // is only marked once shown, so queueing per tick would pile up toasts.
    const pending = pendingFollowUpReminders[0]
    if (pending) {
      pending.count = Math.max(pending.count, count)
      if (onShown) followUpReminderAcknowledgements.set(pending.deliveryId, onShown)
    } else {
      const deliveryId = `follow-up-${++followUpReminderDeliverySequence}`
      if (onShown) followUpReminderAcknowledgements.set(deliveryId, onShown)
      pendingFollowUpReminders.push({ deliveryId, count })
    }
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    return false
  }
  const deliveryId = `follow-up-${++followUpReminderDeliverySequence}`
  if (onShown) followUpReminderAcknowledgements.set(deliveryId, onShown)
  if (!window!.isVisible() || !window!.isFocused()) window!.showInactive()
  window!.flashFrame(true)
  window!.webContents.send('app:follow-up-reminder', { deliveryId, count })
  return false
}

function flushPendingFollowUpReminder() {
  if (!pendingFollowUpReminders.length || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !followUpReminderListenerReady) return
  const pending = pendingFollowUpReminders.splice(0)
  const latest = pending[pending.length - 1]
  if (latest) mainWindow.webContents.send('app:follow-up-reminder', latest)
}

ipcMain.on('app:follow-up-reminder-shown', (event, deliveryId: unknown) => {
  if (event.sender !== mainWindow?.webContents || typeof deliveryId !== 'string') return
  const acknowledge = followUpReminderAcknowledgements.get(deliveryId)
  if (!acknowledge) return
  followUpReminderAcknowledgements.delete(deliveryId)
  acknowledge()
})

ipcMain.on('app:follow-up-reminder-listener-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  followUpReminderListenerReady = true
  flushPendingFollowUpReminder()
})

ipcMain.on('app:search-completion-notice-listener-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  searchCompletionListenerReady = true
  flushPendingSearchCompletionNotice()
})

ipcMain.on('app:search-failed-listener-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  searchFailureListenerReady = true
  flushPendingSearchFailure()
})

async function runSearchNow(notifyUnexpectedFailure = true) {
  if (!database || maintenanceMode) return { added: 0, checkedSources: 0, errors: [], truncated: [] }
  if (activeSearch) return activeSearch
  activeSearch = runSearch(database)
    .then((result) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:search-completed')
      const counts = { added: result.added, errors: result.errors.length, truncated: result.truncated.length }
      reportSearchCompletion(counts, {
        log: (error) => console.error('No se pudo notificar el resultado de la búsqueda:', error),
        isSupported: () => Notification.isSupported() && areWindowsToastNotificationsEnabled(),
        show: (notice, onClick, onFailure) => {
          const notification = new Notification({
            title: notice.title,
            body: notice.body,
          })
          notification.on('click', onClick)
          notification.once('failed', (_event, error) => onFailure(error))
          notification.show()
        },
        onClick: () => {
          mainWindow?.show()
          mainWindow?.focus()
        },
        fallback: (noticeCounts) => showSearchCompletionInApp(noticeCounts),
      })
      return result
    })
    .catch((error: unknown) => {
      const log = (failure: unknown) => console.error('La búsqueda de vacantes falló:', failure)
      if (!notifyUnexpectedFailure) log(error)
      else reportSearchFailure(error, {
        log,
        isSupported: () => Notification.isSupported() && areWindowsToastNotificationsEnabled(),
        show: (notice, onClick) => {
          const notification = new Notification(notice)
          notification.on('click', onClick)
          notification.show()
        },
        onClick: () => {
          mainWindow?.show()
          mainWindow?.focus()
        },
        fallback: showSearchFailureInApp,
      })
      throw error
    })
    .finally(() => { activeSearch = null })
  return activeSearch
}

function showSearchCompletionInApp(counts: SearchCompletionCounts) {
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    pendingSearchCompletionCounts = mergeSearchCompletionCounts(pendingSearchCompletionCounts, counts)
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    return
  }
  if (!window.isVisible() || !window.isFocused()) {
    window.showInactive()
    window.flashFrame(true)
  }
  if (window.webContents.isLoading() || !searchCompletionListenerReady) {
    pendingSearchCompletionCounts = mergeSearchCompletionCounts(pendingSearchCompletionCounts, counts)
    return
  }
  window.webContents.send('app:search-completion-notice', counts)
}

function mergeSearchCompletionCounts(previous: SearchCompletionCounts | null, next: SearchCompletionCounts): SearchCompletionCounts {
  if (!previous) return { ...next }
  return {
    added: previous.added + next.added,
    errors: previous.errors + next.errors,
    truncated: (previous.truncated ?? 0) + (next.truncated ?? 0),
  }
}

function flushPendingSearchCompletionNotice() {
  if (!pendingSearchCompletionCounts || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !searchCompletionListenerReady) return
  const counts = pendingSearchCompletionCounts
  pendingSearchCompletionCounts = null
  mainWindow.webContents.send('app:search-completion-notice', counts)
}

function showSearchFailureInApp() {
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    pendingSearchFailureCount += 1
    return
  }
  if (!window.isVisible() || !window.isFocused()) {
    window.showInactive()
    window.flashFrame(true)
  }
  if (window.webContents.isLoading() || !searchFailureListenerReady) {
    pendingSearchFailureCount += 1
    return
  }
  window.webContents.send('app:search-failed', 1)
}

function flushPendingSearchFailure() {
  if (!pendingSearchFailureCount || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !searchFailureListenerReady) return
  const count = pendingSearchFailureCount
  pendingSearchFailureCount = 0
  mainWindow.webContents.send('app:search-failed', count)
}

async function beginDataRestore() {
  maintenanceMode = true
  if (scheduledSearch) {
    clearInterval(scheduledSearch)
    scheduledSearch = null
  }
  if (followUpReminderTimer) {
    clearInterval(followUpReminderTimer)
    followUpReminderTimer = null
  }
  if (activeSearch) await activeSearch.catch(() => {})
}

function cancelDataRestore() {
  maintenanceMode = false
  try {
    startFollowUpReminderTimer()
    startSearchTimer()
  } catch (error) {
    console.error('No se pudo reanudar la búsqueda tras cancelar la restauración:', error)
  }
}

app.on('window-all-closed', () => {
  // On Windows, the tray keeps the scheduler available until the user selects Salir.
  if (process.platform !== 'win32' && process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  if (scheduledSearch) clearInterval(scheduledSearch)
  if (followUpReminderTimer) clearInterval(followUpReminderTimer)
  void terminateOcrWorker()
  database?.close()
  tray?.destroy()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow?.show()
})
