/**
 * Servicio de actualización automática vía GitHub Releases (electron-updater).
 *
 * Diseño:
 * - La máquina de estados pura (`reduceAppUpdateEvent`, `initialAppUpdateState`)
 *   vive aquí sin dependencias de Electron para poder auditarla con pruebas.
 * - `createAppUpdateService` envuelve `electron-updater` + `BrowserWindow` y
 *   traduce eventos del updater a estados serializables para el renderer.
 * - El renderer consulta el estado por IPC y recibe pushes `app:update-state`.
 *
 * Seguridad:
 * - electron-updater verifica el manifiesto Ed25519 `latest.yml` contra la clave
 *   pública embebida en `app-update.yml` antes de descargar, y contrasta el
 *   SHA-512 del instalador; el feed de GitHub se sirve por HTTPS.
 * - Sin `owner/repo` configurado (ver `electron-builder.json5`), el servicio
 *   queda en `disabled` y explica el paso faltante en Preferencias.
 * - No hay polling agresivo: un chequeo al abrir + chequeo manual + reintento
 *   suave ante errores transitorios (máx. 1/hora) sin spam de red.
 */

export type AppUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  /** Versión remota detectada (si aplica). */
  version: string | null
  /** Progreso de descarga 0-100 (si aplica). */
  percent: number | null
  /** Mensaje listo para mostrar en español. */
  message: string
  /** Detalle técnico en inglés del updater (solo para log). */
  detail: string | null
}

export type AppUpdateEvent =
  | { type: 'disabled'; reason: string }
  | { type: 'check-started' }
  | { type: 'update-available'; version: string | null }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded'; version: string | null }
  | { type: 'up-to-date' }
  | { type: 'error'; detail: string | null }
  | { type: 'reset' }

export const APP_UPDATE_MESSAGES: Record<AppUpdateStatus, string> = {
  disabled: 'Las actualizaciones automáticas no están configuradas todavía.',
  idle: 'Todavía no se buscó una actualización en esta sesión.',
  checking: 'Buscando una actualización…',
  available: 'Hay una actualización disponible. Descargando…',
  downloading: 'Descargando la actualización…',
  downloaded: 'Actualización lista. Se instalará al salir de Radar Laboral.',
  'up-to-date': 'Radar Laboral está actualizado.',
  error: 'No se pudo buscar la actualización. Revisá tu conexión e intentá de nuevo.',
}

const cleanVersion = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const version = value.trim().slice(0, 50)
  return version || null
}

const cleanDetail = (value: unknown): string | null => {
  if (value instanceof Error) return (value.message || 'unknown-error').slice(0, 300)
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300)
  return null
}

const clampPercent = (value: unknown): number | null => {
  const percent = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(percent)) return null
  return Math.max(0, Math.min(100, Math.round(percent)))
}

export function initialAppUpdateState(): AppUpdateState {
  return { status: 'idle', version: null, percent: null, message: APP_UPDATE_MESSAGES.idle, detail: null }
}

export function disabledAppUpdateState(reason: string): AppUpdateState {
  return { status: 'disabled', version: null, percent: null, message: reason.slice(0, 300) || APP_UPDATE_MESSAGES.disabled, detail: null }
}

/**
 * Reductor puro: mismo evento + mismo estado ⇒ mismo resultado.
 * Reglas:
 * - `disabled` es terminal hasta reiniciar (config de build).
 * - `downloaded` no se pisa con `checking`/`up-to-date` (la descarga ganada se conserva).
 * - `error` conserva la versión remota ya detectada, si la había.
 */
export function reduceAppUpdateEvent(current: AppUpdateState, event: AppUpdateEvent): AppUpdateState {
  switch (event.type) {
    case 'disabled':
      return disabledAppUpdateState(event.reason)
    case 'reset':
      return initialAppUpdateState()
    case 'check-started': {
      if (current.status === 'disabled' || current.status === 'downloaded') return current
      if (current.status === 'downloading') return current
      return { status: 'checking', version: current.version, percent: current.status === 'available' ? current.percent : null, message: APP_UPDATE_MESSAGES.checking, detail: null }
    }
    case 'update-available': {
      if (current.status === 'disabled' || current.status === 'downloaded') return current
      const version = cleanVersion(event.version) ?? current.version
      return { status: 'available', version, percent: null, message: version ? `Hay una actualización disponible (${version}). Descargando…` : APP_UPDATE_MESSAGES.available, detail: null }
    }
    case 'download-progress': {
      if (current.status === 'disabled' || current.status === 'downloaded') return current
      const percent = clampPercent(event.percent)
      const version = current.version
      const suffix = version ? ` (${version})` : ''
      return {
        status: 'downloading',
        version,
        percent,
        message: percent === null ? `Descargando la actualización${suffix}…` : `Descargando la actualización${suffix}… ${percent}%`,
        detail: null,
      }
    }
    case 'update-downloaded': {
      if (current.status === 'disabled') return current
      const version = cleanVersion(event.version) ?? current.version
      return { status: 'downloaded', version, percent: 100, message: version ? `Actualización ${version} lista. Se instalará al salir de Radar Laboral.` : APP_UPDATE_MESSAGES.downloaded, detail: null }
    }
    case 'up-to-date': {
      if (current.status === 'disabled' || current.status === 'downloaded' || current.status === 'downloading' || current.status === 'available') return current
      return { status: 'up-to-date', version: current.version, percent: null, message: APP_UPDATE_MESSAGES['up-to-date'], detail: null }
    }
    case 'error': {
      if (current.status === 'disabled' || current.status === 'downloaded') return current
      return { status: 'error', version: current.version, percent: null, message: APP_UPDATE_MESSAGES.error, detail: cleanDetail(event.detail) }
    }
  }
}

export interface AppUpdateSource {
  owner: string | null
  repo: string | null
  configured: boolean
}

/**
 * Resuelve owner/repo SOLO en build-time (vars en la máquina de build).
 * En runtime la app empaquetada NO tiene estas vars: electron-updater lee
 * owner/repo/clave pública de `resources/app-update.yml` generado por
 * electron-builder. Por eso el gating de runtime es `isPackaged` +
 * `updateFeedConfigured` (el main lo deriva de app-update.yml), no este source.
 */
export function resolveAppUpdateSource(env: NodeJS.ProcessEnv = process.env): AppUpdateSource {
  const owner = (env.RADAR_UPDATE_GITHUB_OWNER ?? '').trim() || null
  const repo = (env.RADAR_UPDATE_GITHUB_REPO ?? '').trim() || null
  return { owner, repo, configured: Boolean(owner && repo) }
}

export const APP_UPDATE_DISABLED_MESSAGE =
  'Publicá la app en GitHub Releases y configurá el repositorio (owner/repo) para activar las actualizaciones automáticas.'

type UpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
}

type WindowsLike = {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface AppUpdateServiceOptions {
  updater: UpdaterLike
  isPackaged: boolean
  source: AppUpdateSource
  /** El build embutió un feed real (app-update.yml con owner/repo, sin placeholder). */
  updateFeedConfigured: boolean
  log?: (message: string, detail?: unknown) => void
  getWindows?: () => WindowsLike[]
  now?: () => number
}

export interface AppUpdateService {
  readonly state: AppUpdateState
  readonly source: AppUpdateSource
  start(): void
  checkForUpdates(manual?: boolean): Promise<AppUpdateState>
  quitAndInstall(): void
}

const UPDATE_STATE_CHANNEL = 'app:update-state'
const ERROR_RETRY_MS = 60 * 60 * 1000

/**
 * Integra electron-updater con la ventana principal.
 * - Solo corre empaquetado y con feed real (`app-update.yml` sin placeholder); si no, `disabled`.
 * - `autoDownload=true`: la opción pedida (avisar + instalar al salir).
 * - `autoInstallOnAppQuit=true`: NSIS instala al cerrar, sin forzar reinicio.
 * - Los errores se loguean y se exponen como `error` recuperable (reintento
 *   manual inmediato, automático como máximo 1/hora).
 */
export function createAppUpdateService(options: AppUpdateServiceOptions): AppUpdateService {
  const { updater, isPackaged, source } = options
  const log = options.log ?? (() => {})
  const getWindows = options.getWindows ?? (() => [])
  const now = options.now ?? (() => Date.now())
  const feedReady = isPackaged && options.updateFeedConfigured
  let state: AppUpdateState = feedReady
    ? initialAppUpdateState()
    : disabledAppUpdateState(APP_UPDATE_DISABLED_MESSAGE)
  let started = false
  let checking = false
  let lastErrorRetryAt = 0

  const broadcast = () => {
    for (const window of getWindows()) {
      try {
        if (!window.isDestroyed()) window.webContents.send(UPDATE_STATE_CHANNEL, state)
      } catch (error) {
        log('No se pudo avisar el estado de actualización al renderer.', error)
      }
    }
  }

  const apply = (event: AppUpdateEvent) => {
    const next = reduceAppUpdateEvent(state, event)
    if (next !== state) {
      state = next
      broadcast()
    }
    return state
  }

  const describe = (value: unknown): string | null => {
    if (value instanceof Error) return value.message || 'unknown-error'
    if (typeof value === 'string' && value.trim()) return value
    try {
      return JSON.stringify(value)?.slice(0, 300) ?? null
    } catch {
      return null
    }
  }

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.autoRunAppAfterInstall = false

  updater.on('checking-for-update', () => {
    apply({ type: 'check-started' })
  })
  updater.on('update-available', (info: never) => {
    const version = (info as { version?: unknown } | null)?.version
    log('Actualización disponible.', describe(version))
    apply({ type: 'update-available', version: cleanVersion(version) })
  })
  updater.on('update-not-available', () => {
    apply({ type: 'up-to-date' })
  })
  updater.on('download-progress', (progress: never) => {
    const percent = (progress as { percent?: unknown } | null)?.percent
    apply({ type: 'download-progress', percent: typeof percent === 'number' ? percent : Number.NaN })
  })
  updater.on('update-downloaded', (info: never) => {
    const version = (info as { version?: unknown } | null)?.version
    log('Actualización descargada.', describe(version))
    apply({ type: 'update-downloaded', version: cleanVersion(version) })
  })
  updater.on('error', (error: never) => {
    log('No se pudo buscar la actualización.', error)
    apply({ type: 'error', detail: describe(error) })
  })

  const checkForUpdates = async (manual = false) => {
    if (state.status === 'disabled') return state
    if (checking) return state
    if (state.status === 'downloaded') return state
    if (state.status === 'downloading' && !manual) return state
    if (!manual && state.status === 'error' && now() - lastErrorRetryAt < ERROR_RETRY_MS) return state
    checking = true
    try {
      apply({ type: 'check-started' })
      await updater.checkForUpdates()
      if (state.status === 'error') lastErrorRetryAt = now()
      return state
    } catch (error) {
      log('El chequeo de actualización falló.', error)
      lastErrorRetryAt = now()
      return apply({ type: 'error', detail: describe(error) })
    } finally {
      checking = false
    }
  }

  return {
    get state() {
      return state
    },
    source,
    start() {
      if (started || state.status === 'disabled') return
      started = true
      // Chequeo inicial suave: no bloquea el arranque; si falla, queda `error`
      // recuperable con reintento manual desde Preferencias.
      void checkForUpdates(false)
    },
    checkForUpdates,
    quitAndInstall() {
      if (state.status !== 'downloaded') throw new Error('Todavía no hay una actualización descargada para instalar.')
      updater.quitAndInstall(false, false)
    },
  }
}
