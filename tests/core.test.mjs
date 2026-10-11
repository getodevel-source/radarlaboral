import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateApplicationMessage } from '../electron/ai.ts'
import Database from 'better-sqlite3'
import { RadarDatabase } from '../electron/database.ts'
import { calculateFit, runSearch, searchGeorefLocalities, testConnector, testCsvFeed, testJsonFeed, testRssFeed } from '../electron/search.ts'
import { jsonFeedItemCount, mapJsonFeed, validateJsonSourceConfig } from '../electron/connectors/json-feed.ts'
import { mapCsvFeed, validateCsvSourceConfig } from '../electron/connectors/csv-feed.ts'
import { importLocalCsv } from '../electron/csv-import.ts'
import { importLocalJson, previewLocalJsonImport } from '../electron/json-import.ts'
import { currentSalaryExchangeRates, fetchBcraSalaryExchangeRates, parseBcraSalaryExchangeRates } from '../electron/exchange-rates.ts'
import { decodeCsvBytes, detectCsvDelimiter } from '../src/shared/csv.ts'
import { normalizeOpportunityUrl } from '../src/shared/opportunity-url.ts'
import { fetchAllLeverPostings, LEVER_MAX_ARGENTINA_POSTINGS, LEVER_MAX_POSTINGS, leverArgentinaPayload } from '../src/shared/lever.ts'
import { validateOpportunityTracking } from '../src/shared/opportunity-tracking.ts'
import { normalizeSalaryCurrency, normalizeSalaryPeriod, parseMonthlySalary, parseSalaryAmount } from '../electron/salary.ts'
import { findVerifiedSourcePolicy, requireVerifiedSourcePolicy, verifiedSourcePolicyMatchesJsonConfig, VERIFIED_SOURCE_POLICIES } from '../src/shared/verified-source-policies.ts'
import { recognizeOcrImage, terminateOcrWorker } from '../electron/ocr.ts'
import { copyPdfBytesForWorker } from '../src/pdf-import.ts'
import { testPdfExportDirectoryFromArgs, userDataPathFromArgs } from '../electron/user-data-path.ts'
import { writeExclusiveCopy } from '../electron/exclusive-file-write.ts'
import { MANUAL_PORTALS } from '../src/shared/manual-portals.ts'
import { activateModalFocus } from '../src/modal-focus.ts'
import { SMARTRECRUITERS_CIELO_COMPANY, SMARTRECRUITERS_CIELO_URL, SMARTRECRUITERS_COFACE_COMPANY, SMARTRECRUITERS_COFACE_URL, SMARTRECRUITERS_LDC_COMPANY, SMARTRECRUITERS_LDC_URL, SMARTRECRUITERS_MIRATECH_COMPANY, SMARTRECRUITERS_MIRATECH_URL, SMARTRECRUITERS_PSI_CRO_COMPANY, SMARTRECRUITERS_PSI_CRO_URL, smartRecruitersArgentinaJsonConfig, smartRecruitersDetailsPayload, smartRecruitersPostingIds } from '../src/shared/smartrecruiters.ts'
import { GREENHOUSE_MAX_JOBS, greenhouseArgentinaJsonConfig, greenhouseArgentinaPayload } from '../src/shared/greenhouse.ts'
import { ashbyArgentinaJsonConfig, ashbyArgentinaPayload } from '../src/shared/ashby.ts'
import { workableArgentinaJsonConfig, workableArgentinaPayload, WORKABLE_MAX_ARGENTINA_JOBS, WORKABLE_MAX_PUBLIC_JOBS, WORKABLE_SUR_URL } from '../src/shared/workable.ts'
import { createBackgroundTaskXml, syncWindowsBackgroundSchedule } from '../electron/background-schedule.ts'
import { reportSearchCompletion, reportSearchFailure, searchCompletionNotice, searchFailureNotice } from '../electron/search-notifications.ts'
import { deliverDueFollowUpReminders, followUpReminderNotice, reportFollowUpReminder, windowsToastSettingAllowsNotifications } from '../electron/follow-up-notifications.ts'
import { createContentSecurityPolicyPlugin } from '../build/content-security-policy.mjs'
import { configureWindowsNotificationIdentity, WINDOWS_APP_USER_MODEL_ID, WINDOWS_TOAST_ACTIVATOR_CLSID } from '../electron/windows-notification-identity.ts'
import { createAppUpdateService, disabledAppUpdateState, initialAppUpdateState, reduceAppUpdateEvent, resolveAppUpdateSource } from '../electron/app-updates.ts'

function createModalFocusFixture(elementTypes = ['button', 'input', 'button']) {
  const listeners = new Map()
  const ownerDocument = {
    activeElement: null,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(listener)
      listeners.set(type, handlers)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
  }
  const createElement = (kind) => ({
    kind,
    hidden: false,
    isConnected: true,
    matches: (selector) => selector === 'input, select, textarea' && ['input', 'select', 'textarea'].includes(kind),
    closest: () => null,
    getClientRects: () => [{}],
    focus() {
      ownerDocument.activeElement = this
      ownerDocument.dispatch('focusin', { target: this })
    },
  })
  const opener = createElement('button')
  const controls = elementTypes.map(createElement)
  const dialog = createElement('dialog')
  dialog.querySelectorAll = () => controls
  dialog.contains = (element) => element === dialog || controls.includes(element)
  ownerDocument.activeElement = opener
  return { ownerDocument, opener, controls, dialog, listeners, createElement }
}

function dispatchModalKey(ownerDocument, key, shiftKey = false) {
  const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  ownerDocument.dispatch('keydown', event)
  return event.defaultPrevented
}

test('configures stable Windows notification identity from the NSIS app ID', () => {
  const calls = []
  const application = {
    setAppUserModelId: (id) => calls.push(['appUserModelId', id]),
    setToastActivatorCLSID: (id) => calls.push(['toastActivatorCLSID', id]),
  }
  const config = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')
  const appId = config.match(/^\s*"appId":\s*"([^"]+)"/mu)?.[1]

  assert.equal(appId, WINDOWS_APP_USER_MODEL_ID)
  assert.match(WINDOWS_TOAST_ACTIVATOR_CLSID, /^\{[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}$/iu)
  assert.equal(configureWindowsNotificationIdentity('win32', application), true)
  assert.deepEqual(calls, [
    ['appUserModelId', WINDOWS_APP_USER_MODEL_ID],
    ['toastActivatorCLSID', WINDOWS_TOAST_ACTIVATOR_CLSID],
  ])

  assert.equal(configureWindowsNotificationIdentity('linux', application), false)
  assert.equal(calls.length, 2)
})

test('traps modal keyboard focus, closes with Escape, and restores its opener', async () => {
  const { ownerDocument, opener, controls, dialog, listeners, createElement } = createModalFocusFixture()
  let closeCount = 0
  const restoreFocus = activateModalFocus(dialog, () => { closeCount += 1 }, ownerDocument)

  assert.equal(ownerDocument.activeElement, controls[1])
  controls[2].focus()
  assert.equal(dispatchModalKey(ownerDocument, 'Tab'), true)
  assert.equal(ownerDocument.activeElement, controls[0])
  assert.equal(dispatchModalKey(ownerDocument, 'Tab', true), true)
  assert.equal(ownerDocument.activeElement, controls[2])

  const outsideControl = createElement('button')
  outsideControl.focus()
  assert.equal(ownerDocument.activeElement, controls[1])
  assert.equal(dispatchModalKey(ownerDocument, 'Escape'), true)
  assert.equal(closeCount, 1)

  restoreFocus()
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.equal(ownerDocument.activeElement, opener)
  assert.equal(listeners.get('keydown').size, 0)
  assert.equal(listeners.get('focusin').size, 0)
})

test('restores modal opener after an inert background is released', async () => {
  const { ownerDocument, opener, dialog } = createModalFocusFixture([])
  const focus = opener.focus.bind(opener)
  ownerDocument.blockOpenerFocus = false
  opener.focus = () => {
    if (ownerDocument.blockOpenerFocus) return
    focus()
  }
  const restoreFocus = activateModalFocus(dialog, () => {}, ownerDocument)

  ownerDocument.blockOpenerFocus = true
  restoreFocus()
  ownerDocument.blockOpenerFocus = false
  await new Promise((resolve) => queueMicrotask(resolve))

  assert.equal(ownerDocument.activeElement, opener)
})

test('keeps focus on an empty modal when Tab is pressed', () => {
  const { ownerDocument, dialog } = createModalFocusFixture([])
  const restoreFocus = activateModalFocus(dialog, () => {}, ownerDocument)

  assert.equal(ownerDocument.activeElement, dialog)
  assert.equal(dispatchModalKey(ownerDocument, 'Tab'), true)
  assert.equal(ownerDocument.activeElement, dialog)
  restoreFocus()
})

test('notifies about an unexpected search failure without exposing its details', () => {
  const error = new Error('https://jobs.example/?token=private-value')
  const logged = []
  const shown = []
  let focused = 0
  const notified = reportSearchFailure(error, {
    log: (value) => logged.push(value),
    isSupported: () => true,
    show: (notice, onClick) => shown.push({ notice, onClick }),
    onClick: () => { focused += 1 },
    fallback: () => assert.fail('No se esperaba el fallback con notificaciones disponibles.'),
  })

  assert.equal(notified, true)
  assert.deepEqual(logged, [error])
  assert.equal(shown.length, 1)
  assert.deepEqual(shown[0].notice, searchFailureNotice)
  assert.doesNotMatch(JSON.stringify(shown[0].notice), /private-value/u)
  shown[0].onClick()
  assert.equal(focused, 1)
})

test('shows an in-app fallback when system notifications are unavailable', () => {
  const error = new Error('SQLite disk error')
  const logged = []
  let shown = 0
  let fallback = 0
  const notified = reportSearchFailure(error, {
    log: (value) => logged.push(value),
    isSupported: () => false,
    show: () => { shown += 1 },
    onClick: () => {},
    fallback: () => { fallback += 1 },
  })

  assert.equal(notified, false)
  assert.deepEqual(logged, [error])
  assert.equal(shown, 0)
  assert.equal(fallback, 1)
})

test('falls back in-app if creating a system notification throws', () => {
  const error = new Error('database locked')
  const notificationError = new Error('notification unavailable')
  const logged = []
  let fallback = 0
  const notified = reportSearchFailure(error, {
    log: (value) => logged.push(value),
    isSupported: () => true,
    show: () => { throw notificationError },
    onClick: () => {},
    fallback: () => { fallback += 1 },
  })

  assert.equal(notified, false)
  assert.deepEqual(logged, [error, notificationError])
  assert.equal(fallback, 1)
})

test('summarizes search completion counts without exposing source details', () => {
  const notice = searchCompletionNotice({ added: 2, errors: 1 })
  assert.deepEqual(notice, {
    title: 'Actualización de Radar Laboral',
    body: 'Se agregaron 2 avisos nuevos. Falló la consulta de 1 fuente. Revisá Fuentes.',
  })
  assert.equal(searchCompletionNotice({ added: 0, errors: 0 }), null)
  assert.equal(searchCompletionNotice({ added: -1, errors: 2 }), null)
  assert.deepEqual(searchCompletionNotice({ added: 0, errors: 0, truncated: 2 }), {
    title: 'Revisá tus fuentes de empleo',
    body: '2 fuentes devolvieron más avisos de los revisados por consulta.',
  })
  assert.equal(searchCompletionNotice({ added: 0, errors: 0, truncated: -1 }), null)
})

test('uses a system notification for search results and falls back if Windows rejects it', () => {
  const shown = []
  const fallback = []
  const opened = []
  const logged = []
  const notificationError = new Error('toast unavailable')
  const notified = reportSearchCompletion({ added: 1, errors: 2 }, {
    log: (error) => logged.push(error),
    isSupported: () => true,
    show: (notice, onClick, onFailure) => shown.push({ notice, onClick, onFailure }),
    onClick: () => opened.push(true),
    fallback: (counts) => fallback.push(counts),
  })

  assert.equal(notified, true)
  assert.deepEqual(shown[0].notice, {
    title: 'Actualización de Radar Laboral',
    body: 'Se agregó 1 aviso nuevo. Falló la consulta de 2 fuentes. Revisá Fuentes.',
  })
  shown[0].onClick()
  assert.deepEqual(opened, [true])
  shown[0].onFailure(notificationError)
  assert.deepEqual(logged, [notificationError])
  assert.deepEqual(fallback, [{ added: 1, errors: 2 }])
})

test('uses the in-app notice for search results when Windows toasts are disabled', () => {
  const fallback = []
  const notified = reportSearchCompletion({ added: 3, errors: 0 }, {
    log: () => assert.fail('No se esperaba registrar un error.'),
    isSupported: () => false,
    show: () => assert.fail('No debe intentar un toast deshabilitado.'),
    onClick: () => {},
    fallback: (counts) => fallback.push(counts),
  })

  assert.equal(notified, false)
  assert.deepEqual(fallback, [{ added: 3, errors: 0 }])
})

test('keeps follow-up notifications generic and opens the app from the system notice', () => {
  assert.deepEqual(followUpReminderNotice(1), {
    title: 'Tenés seguimientos pendientes',
    body: 'Llegó la fecha para retomar una postulación. Abrí Radar Laboral para revisarla.',
  })
  assert.match(followUpReminderNotice(3).body, /3 postulaciones/u)
  assert.equal(followUpReminderNotice(0), null)
  assert.equal(followUpReminderNotice(Number.NaN), null)

  const shown = []
  const opened = []
  const notified = reportFollowUpReminder(2, {
    log: () => assert.fail('No se esperaba registrar un error.'),
    isSupported: () => true,
    show: (notice, onClick, onShown, onFailure) => shown.push({ notice, onClick, onShown, onFailure }),
    onClick: (count) => opened.push(count),
    fallback: () => assert.fail('No se esperaba el fallback.'),
  })

  assert.equal(notified, true)
  assert.equal(shown.length, 1)
  assert.match(shown[0].notice.body, /2 postulaciones/u)
  assert.doesNotMatch(JSON.stringify(shown[0].notice), /Empresa|Aviso privado/u)
  shown[0].onShown()
  shown[0].onClick()
  assert.deepEqual(opened, [2])
})

test('detects when Windows globally disables toast notifications', () => {
  assert.equal(windowsToastSettingAllowsNotifications('ToastEnabled    REG_DWORD    0x0'), false)
  assert.equal(windowsToastSettingAllowsNotifications('ToastEnabled    REG_DWORD    0x1'), true)
  assert.equal(windowsToastSettingAllowsNotifications(''), true)
  assert.equal(windowsToastSettingAllowsNotifications(null), true)
})

test('uses the in-app fallback for follow-up notices when Windows notifications are unavailable', () => {
  const fallbackCounts = []
  let shown = 0
  const notified = reportFollowUpReminder(4, {
    log: () => assert.fail('No se esperaba registrar un error.'),
    isSupported: () => false,
    show: () => { shown += 1 },
    onClick: () => {},
    fallback: (count) => { fallbackCounts.push(count); return true },
  })

  assert.equal(notified, true)
  assert.equal(shown, 0)
  assert.deepEqual(fallbackCounts, [4])
})

test('delivers due follow-up reminders once per date and persists the marker', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-follow-up-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const today = '2026-10-08'
  const database = new RadarDatabase(directory)
  const createTracked = (slug, status, followUpDate) => {
    const opportunity = database.addOpportunity({
      profileId: null,
      title: `Aviso ${slug}`,
      company: `Empresa ${slug}`,
      location: '',
      source: 'Prueba',
      url: `https://example.com/follow-up/${slug}`,
      description: '',
      salaryText: '',
    })
    database.updateOpportunityStatus(opportunity.id, status)
    database.updateOpportunityTracking(opportunity.id, {
      appliedDate: null,
      followUpDate,
      trackingNotes: '',
    })
    return opportunity.id
  }
  const dueId = createTracked('due', 'postulada', today)
  const overdueId = createTracked('overdue', 'postulada', '2026-10-01')
  createTracked('future', 'postulada', '2026-10-09')
  createTracked('saved', 'guardada', today)

  assert.deepEqual(database.listDueFollowUps(today).map((reminder) => reminder.id), [overdueId, dueId])
  const deliveredNotices = []
  const reporter = {
    log: (error) => assert.fail(String(error)),
    isSupported: () => true,
    show: (notice, _onClick, onShown) => {
      deliveredNotices.push(notice)
      onShown()
    },
    onClick: () => {},
    fallback: () => false,
  }
  assert.equal(deliverDueFollowUpReminders(database, today, reporter), 2)
  assert.equal(deliveredNotices.length, 1)
  assert.match(deliveredNotices[0].body, /2 postulaciones/u)
  assert.doesNotMatch(deliveredNotices[0].body, /Empresa|Aviso/u)
  assert.equal(deliverDueFollowUpReminders(database, today, reporter), 0)
  database.close()

  const reopened = new RadarDatabase(directory)
  assert.deepEqual(reopened.listDueFollowUps(today), [])
  assert.equal(deliverDueFollowUpReminders(reopened, today, reporter), 0)

  reopened.updateOpportunityTracking(dueId, {
    appliedDate: null,
    followUpDate: '2026-10-07',
    trackingNotes: '',
  })
  assert.equal(reopened.listDueFollowUps(today).some((reminder) => reminder.id === dueId), true)
  assert.equal(deliverDueFollowUpReminders(reopened, today, reporter), 1)
  assert.equal(deliverDueFollowUpReminders(reopened, today, reporter), 0)
  reopened.close()
})

test('keeps a due follow-up pending until its native notification is shown', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-pending-follow-up-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const today = '2026-10-08'
  const database = new RadarDatabase(directory)
  const opportunity = database.addOpportunity({
    profileId: null,
    title: 'Aviso pendiente',
    company: 'Empresa de prueba',
    location: '',
    source: 'Prueba',
    url: 'https://example.com/follow-up/pending-native-show',
    description: '',
    salaryText: '',
  })
  database.updateOpportunityStatus(opportunity.id, 'postulada')
  database.updateOpportunityTracking(opportunity.id, { appliedDate: today, followUpDate: today, trackingNotes: '' })

  let onShown = null
  const reporter = {
    log: (error) => assert.fail(String(error)),
    isSupported: () => true,
    show: (_notice, _onClick, shown) => { onShown = shown },
    onClick: () => {},
    fallback: () => false,
  }

  assert.equal(deliverDueFollowUpReminders(database, today, reporter), 0)
  assert.deepEqual(database.listDueFollowUps(today).map((reminder) => reminder.id), [opportunity.id])
  assert.equal(typeof onShown, 'function')
  onShown()
  assert.deepEqual(database.listDueFollowUps(today), [])
  database.close()
})

test('keeps a due follow-up pending until the in-app fallback confirms it was displayed', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-pending-fallback-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const today = '2026-10-08'
  const database = new RadarDatabase(directory)
  const opportunity = database.addOpportunity({
    profileId: null,
    title: 'Aviso fallback pendiente',
    company: 'Empresa de prueba',
    location: '',
    source: 'Prueba',
    url: 'https://example.com/follow-up/pending-fallback-show',
    description: '',
    salaryText: '',
  })
  database.updateOpportunityStatus(opportunity.id, 'postulada')
  database.updateOpportunityTracking(opportunity.id, { appliedDate: today, followUpDate: today, trackingNotes: '' })

  let onShown = null
  const reporter = {
    log: (error) => assert.fail(String(error)),
    isSupported: () => false,
    show: () => assert.fail('No se esperaba un aviso nativo.'),
    onClick: () => {},
    fallback: (_count, shown) => { onShown = shown; return false },
  }

  assert.equal(deliverDueFollowUpReminders(database, today, reporter), 0)
  assert.deepEqual(database.listDueFollowUps(today).map((reminder) => reminder.id), [opportunity.id])
  assert.equal(typeof onShown, 'function')
  onShown()
  assert.deepEqual(database.listDueFollowUps(today), [])
  database.close()
})

test('marks due follow-ups after a failed native notification is delivered by the in-app fallback', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-failed-follow-up-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const today = '2026-10-08'
  const database = new RadarDatabase(directory)
  const opportunity = database.addOpportunity({
    profileId: null,
    title: 'Aviso recuperado',
    company: 'Empresa de prueba',
    location: '',
    source: 'Prueba',
    url: 'https://example.com/follow-up/native-failure-fallback',
    description: '',
    salaryText: '',
  })
  database.updateOpportunityStatus(opportunity.id, 'postulada')
  database.updateOpportunityTracking(opportunity.id, { appliedDate: today, followUpDate: today, trackingNotes: '' })

  const nativeError = new Error('Windows no pudo mostrar el aviso')
  let onFailure = null
  const logged = []
  const reporter = {
    log: (error) => logged.push(error),
    isSupported: () => true,
    show: (_notice, _onClick, _onShown, failed) => { onFailure = failed },
    onClick: () => {},
    fallback: () => true,
  }

  assert.equal(deliverDueFollowUpReminders(database, today, reporter), 0)
  assert.equal(typeof onFailure, 'function')
  onFailure(nativeError)
  assert.deepEqual(logged, [nativeError])
  assert.deepEqual(database.listDueFollowUps(today), [])
  database.close()
})

test('builds a per-user Windows schedule without passwords and preserves a custom data folder', () => {
  const xml = createBackgroundTaskXml(
    'C:\\Program Files\\Radar & Laboral\\Radar Laboral.exe',
    'S-1-5-21-1000',
    12,
    '2026-10-08T15:00:00',
    'D:\\Radar Laboral\\Datos',
  )

  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/u)
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/u)
  assert.match(xml, /<Interval>PT12H<\/Interval>/u)
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/u)
  assert.match(xml, /Radar &amp; Laboral\\Radar Laboral\.exe/u)
  assert.match(xml, /--radar-user-data-dir=&quot;D:\\Radar Laboral\\Datos&quot;/u)
  assert.doesNotMatch(xml, /<Password>|<RunLevel>Highest/u)
  assert.throws(() => createBackgroundTaskXml('C:\\Radar.exe', 'S-1-5-21-1000', 6), /intervalo/u)
  assert.throws(() => createBackgroundTaskXml('C:\\Radar.exe', 'S-1-5-21-1000', 4, undefined, '\\\\server\\share'), /carpeta local/u)
})

test('registers and removes the scheduled task using only explicit local commands', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-scheduler-test-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const calls = []
  let registeredXml = ''
  const dependencies = {
    tempDirectory: directory,
    taskName: 'RadarLaboral-Test-BackgroundSearch',
    startBoundary: '2030-01-01T00:00:00',
    userSid: async () => 'S-1-5-21-1000',
    runCommand: async (_program, args) => {
      calls.push(args)
      if (args[0] === '/create') {
        registeredXml = fs.readFileSync(args[args.indexOf('/xml') + 1]).toString('utf16le').replace(/^\uFEFF/u, '')
      }
      return { stdout: '', stderr: '' }
    },
  }

  await syncWindowsBackgroundSchedule(true, 'C:\\Radar Laboral.exe', 4, null, dependencies)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 3), ['/create', '/tn', dependencies.taskName])
  assert.match(registeredXml, /<UserId>S-1-5-21-1000<\/UserId>/u)
  assert.match(registeredXml, /--radar-background-run/u)
  assert.equal(fs.readdirSync(directory).length, 0)

  const missingTaskRun = async (_program, args) => {
    calls.push(args)
    const error = new Error('ERROR: The system cannot find the file specified.')
    error.stderr = error.message
    throw error
  }
  await syncWindowsBackgroundSchedule(false, 'C:\\Radar Laboral.exe', 4, null, { ...dependencies, runCommand: missingTaskRun })
  assert.deepEqual(calls[1].slice(0, 3), ['/delete', '/tn', dependencies.taskName])
})

test('accepts a single absolute user-data override and rejects ambiguous paths', () => {
  assert.equal(userDataPathFromArgs(['Radar Laboral.exe']), null)
  assert.equal(userDataPathFromArgs(['Radar Laboral.exe', '--radar-user-data-dir=C:\\Radar Laboral\\Datos']), path.normalize('C:\\Radar Laboral\\Datos'))
  assert.throws(() => userDataPathFromArgs(['--radar-user-data-dir=relative\\datos']), /unidad local/u)
  assert.throws(() => userDataPathFromArgs([String.raw`--radar-user-data-dir=\\server\share`]), /unidad local/u)
  assert.throws(() => userDataPathFromArgs(['--radar-user-data-dir', 'C:\\Radar']), /una sola ruta/u)
  assert.throws(() => userDataPathFromArgs(['--radar-user-data-dir=C:\\Uno', '--radar-user-data-dir=C:\\Dos']), /una sola ruta/u)
})

test('limits test PDF exports to a dedicated directory under explicit user data', () => {
  const userDataPath = path.normalize('C:\\Radar Laboral\\Datos')
  assert.equal(testPdfExportDirectoryFromArgs(['Radar Laboral.exe'], userDataPath), null)
  assert.equal(
    testPdfExportDirectoryFromArgs(['Radar Laboral.exe', '--radar-test-export-copies'], userDataPath),
    path.join(userDataPath, 'test-exports'),
  )
  assert.throws(() => testPdfExportDirectoryFromArgs(['--radar-test-export-copies'], null), /user-data-dir/u)
  assert.throws(() => testPdfExportDirectoryFromArgs(['--radar-test-export-copies=value'], userDataPath), /user-data-dir/u)
  assert.throws(() => testPdfExportDirectoryFromArgs(['--radar-test-export-copies', '--radar-test-export-copies'], userDataPath), /user-data-dir/u)
})

test('keeps all curated career portals as HTTPS manual links, including public-sector calls', () => {
  assert.deepEqual(MANUAL_PORTALS.map(({ name, url }) => ({ name, url })), [
    { name: 'Bumeran', url: 'https://www.bumeran.com.ar/' },
    { name: 'Jooble Argentina', url: 'https://ar.jooble.org/' },
    { name: 'ZonaJobs', url: 'https://www.zonajobs.com.ar/' },
    { name: 'Computrabajo', url: 'https://ar.computrabajo.com/' },
    { name: 'Conexiona RRHH · varios rubros', url: 'https://conexionarrhh.com/avisos-de-empleos/' },
    { name: 'LaburoCerca · empleos en Argentina', url: 'https://laburocerca.com.ar/' },
    { name: 'Indeed Argentina', url: 'https://ar.indeed.com/' },
    { name: 'LinkedIn Empleos', url: 'https://www.linkedin.com/jobs/' },
    { name: 'Portal Empleo', url: 'https://www.portalempleo.gob.ar/' },
    { name: 'Concursar · empleo público', url: 'https://www.argentina.gob.ar/node/26728' },
    { name: 'Assist World · verificar elegibilidad Wise', url: 'https://jobs.lever.co/assist-world?location=Argentina' },
    { name: 'Remote · revisar requisitos por país', url: 'https://remote.com/openings' },
  ])
  assert.ok(MANUAL_PORTALS.every((portal) => new URL(portal.url).protocol === 'https:'))
  assert.ok(MANUAL_PORTALS.every((portal) => !Object.hasOwn(portal, 'kind')))
})

test('refuses to replace an existing file and reports how to choose another name', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-exclusive-copy-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const existingPath = path.join(directory, 'original.pdf')
  const original = Buffer.from('%PDF-1.4 original')
  fs.writeFileSync(existingPath, original)

  await assert.rejects(writeExclusiveCopy(existingPath, Buffer.from('%PDF-1.4 replacement')), /Ya existe un archivo en esa ubicación/u)
  assert.deepEqual(fs.readFileSync(existingPath), original)

  const copyPath = path.join(directory, 'copy.pdf')
  const copy = Buffer.from('%PDF-1.4 copy')
  await writeExclusiveCopy(copyPath, copy)
  assert.deepEqual(fs.readFileSync(copyPath), copy)
})

test('recognizes scanned CV text locally in Spanish and English', async (context) => {
  context.after(() => terminateOcrWorker())
  const { createCanvas } = await import('@napi-rs/canvas')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const canvas = createCanvas(1500, 430)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = '#fff'
  drawing.fillRect(0, 0, canvas.width, canvas.height)
  drawing.fillStyle = '#000'
  drawing.font = 'bold 58px Arial'
  drawing.fillText('MARÍA LÓPEZ', 35, 95)
  drawing.font = 'bold 74px Arial'
  drawing.fillText('ADMINISTRATIVA CONTABLE', 35, 185)
  drawing.font = '60px Arial'
  drawing.fillText('Project Manager', 35, 275)
  drawing.font = '48px Arial'
  drawing.fillText('Experiencia laboral en Rosario', 35, 355)

  const image = new Uint8Array(canvas.toBuffer('image/png'))
  const recognized = await recognizeOcrImage(image)
  assert.match(recognized, /MARÍA LÓPEZ/u)
  assert.match(recognized, /ADMINISTRATIVA CONTABLE/u)
  assert.match(recognized, /Project Manager/u)
  assert.match(recognized, /Rosario/u)
  await assert.rejects(recognizeOcrImage(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)), /PNG válido/u)

  const twoColumnScan = createCanvas(1800, 900)
  const twoColumnDrawing = twoColumnScan.getContext('2d')
  twoColumnDrawing.fillStyle = '#fff'
  twoColumnDrawing.fillRect(0, 0, twoColumnScan.width, twoColumnScan.height)
  twoColumnDrawing.save()
  twoColumnDrawing.translate(twoColumnScan.width / 2, twoColumnScan.height / 2)
  twoColumnDrawing.rotate(-Math.PI / 180)
  twoColumnDrawing.translate(-twoColumnScan.width / 2, -twoColumnScan.height / 2)
  twoColumnDrawing.fillStyle = '#595959'
  twoColumnDrawing.font = 'bold 32px Arial'
  twoColumnDrawing.fillText('PERFIL PROFESIONAL', 80, 105)
  twoColumnDrawing.font = 'bold 27px Arial'
  twoColumnDrawing.fillText('EXPERIENCIA', 90, 220)
  twoColumnDrawing.fillText('FORMACION', 970, 220)
  twoColumnDrawing.font = '24px Arial'
  twoColumnDrawing.fillText('Analista de datos - Mercado Sur', 90, 275)
  twoColumnDrawing.fillText('2019 - 2024 | Rosario, Argentina', 90, 325)
  twoColumnDrawing.fillText('SQL, Excel y automatizacion de reportes', 90, 375)
  twoColumnDrawing.fillText('Licenciatura en Sistemas', 970, 275)
  twoColumnDrawing.fillText('Universidad Nacional', 970, 325)
  twoColumnDrawing.fillText('Ingles intermedio', 970, 375)
  twoColumnDrawing.restore()
  const twoColumnText = await recognizeOcrImage(new Uint8Array(twoColumnScan.toBuffer('image/png')))
  assert.match(twoColumnText, /Analista de datos/u)
  assert.match(twoColumnText, /Rosario, Argentina/u)
  assert.match(twoColumnText, /Licenciatura en Sistemas/u)

  const jpeg = canvas.toBuffer('image/jpeg', 95)
  const content = Buffer.from('q 540 0 0 154 28 650 cm /Im0 Do Q\n')
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'),
    Buffer.concat([Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream\nendobj\n')]),
    Buffer.concat([Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream\nendobj\n')]),
  ]
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const offsets = [0]
  let offset = header.length
  for (const object of objects) { offsets.push(offset); offset += object.length }
  const xref = Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
  const pdfBytes = Buffer.concat([header, ...objects, xref])
  const bytesForStorage = new Uint8Array(pdfBytes)
  const loadingTask = getDocument({ data: copyPdfBytesForWorker(bytesForStorage) })
  try {
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    assert.equal((await page.getTextContent()).items.length, 0)
    const unitViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.sqrt(4_000_000 / (unitViewport.width * unitViewport.height)))
    const viewport = page.getViewport({ scale })
    const rendered = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvas: rendered, canvasContext: rendered.getContext('2d'), viewport }).promise
    const fromPdf = await recognizeOcrImage(new Uint8Array(rendered.toBuffer('image/png')))
    assert.match(fromPdf, /MARÍA LÓPEZ/u)
    assert.match(fromPdf, /ADMINISTRATIVA CONTABLE/u)
    assert.match(fromPdf, /Project Manager/u)
  } finally {
    await loadingTask.destroy()
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-ocr-import-'))
  const database = new RadarDatabase(directory)
  try {
    const resume = database.addResume({
      name: 'CV escaneado',
      originalName: 'cv-escaneado.pdf',
      pageCount: 1,
      extractedText: 'ADMINISTRATIVA CONTABLE',
      bytes: bytesForStorage,
    })
    assert.equal(resume.originalName, 'cv-escaneado.pdf')
    assert.deepEqual(fs.readFileSync(path.join(directory, 'resumes', `${resume.id}.pdf`)), pdfBytes)
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('uses resolved locations for radius and preserves uncertain postings when another locality is ambiguous', () => {
  const profile = {
    id: 'geo',
    name: 'Rosario',
    searchDescription: '',
    roles: [],
    locations: ['Rosario, Santa Fe'],
    radiusKm: 25,
    includeKeywords: [],
    excludeKeywords: [],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: null,
    active: true,
    createdAt: '',
    updatedAt: '',
  }

  const nearby = calculateFit(profile, 'Administrativa', '', 'Funes, Santa Fe, Argentina')
  assert.ok(nearby)
  assert.match(nearby.reasons.join(' '), /A 13 km de Rosario en línea recta \(Georef\)/)
  assert.equal(calculateFit(profile, 'Administrativa', '', 'Resistencia, Chaco'), null)

  const marDelPlata = calculateFit(
    { ...profile, locations: ['Mar del Plata, Buenos Aires'], radiusKm: 10 },
    'Administrativa',
    '',
    'Mar del Plata, Buenos Aires, Argentina',
  )
  assert.ok(marDelPlata)
  assert.ok(marDelPlata.reasons.some((reason) => reason.startsWith('A 0 km de Mar del Plata')))

  const departmentDisambiguated = calculateFit(
    { ...profile, locations: ['Espartillar, Saavedra, Buenos Aires'], radiusKm: 10 },
    'Administrativa',
    '',
    'Espartillar, Saavedra, Buenos Aires, Argentina',
  )
  assert.ok(departmentDisambiguated)
  assert.ok(departmentDisambiguated.reasons.some((reason) => reason.startsWith('A 0 km de Espartillar')))

  const localGovernmentDisambiguated = calculateFit(
    { ...profile, locations: ['Barrio La Costa, Cipolletti, General Roca, Río Negro'], radiusKm: 10 },
    'Administrativa',
    '',
    'Barrio La Costa, Cipolletti, General Roca, Río Negro, Argentina',
  )
  assert.ok(localGovernmentDisambiguated)
  assert.ok(localGovernmentDisambiguated.reasons.some((reason) => reason.startsWith('A 0 km de Barrio La Costa')))

  const ambiguousLocalGovernment = calculateFit(
    { ...profile, locations: ['Barrio La Costa, General Roca, Río Negro'], radiusKm: 10 },
    'Administrativa',
    '',
    'Barrio La Costa, General Roca, Río Negro',
  )
  assert.ok(ambiguousLocalGovernment)
  assert.ok(ambiguousLocalGovernment.missing.some((reason) => reason.includes('localidad oficial inequívoca')))

  const ambiguousOrigin = { ...profile, locations: ['Espartillar, Buenos Aires'], radiusKm: 10 }
  const uncertain = calculateFit(ambiguousOrigin, 'Administrativa', '', 'Buenos Aires Chico, Chubut')
  assert.ok(uncertain)
  assert.ok(uncertain.missing.some((reason) => reason.includes('localidad oficial inequívoca')))

  const duplicateSuggestions = searchGeorefLocalities('Carolina, Goya, Corrientes')
  assert.deepEqual(duplicateSuggestions.map((locality) => locality.id), ['18070010', '18070011'])
  assert.notEqual(duplicateSuggestions[0]?.lat, duplicateSuggestions[1]?.lat)
  const selectedDuplicate = calculateFit(
    { ...profile, locations: ['Carolina, Goya, Corrientes [Georef:18070010]'], radiusKm: 10 },
    'Administrativa',
    '',
    'Rosario, Santa Fe',
  )
  assert.equal(selectedDuplicate, null)
  const unresolvedDuplicate = calculateFit(
    { ...profile, locations: ['Carolina, Goya, Corrientes'], radiusKm: 10 },
    'Administrativa',
    '',
    'Rosario, Santa Fe',
  )
  assert.ok(unresolvedDuplicate)
  assert.ok(unresolvedDuplicate.missing.some((reason) => reason.includes('localidad oficial inequívoca')))

  const mixedOrigins = { ...profile, locations: ['Rosario, Santa Fe', 'Espartillar, Buenos Aires'], radiusKm: 25 }
  const confidentlyNearby = calculateFit(mixedOrigins, 'Administrativa', '', 'Funes, Santa Fe, Argentina')
  assert.ok(confidentlyNearby)
  assert.ok(confidentlyNearby.reasons.some((reason) => reason.startsWith('A 13 km de Rosario')))
  const uncertainOutsideKnownOrigin = calculateFit(mixedOrigins, 'Administrativa', '', 'Resistencia, Chaco')
  assert.ok(uncertainOutsideKnownOrigin)
  assert.ok(uncertainOutsideKnownOrigin.missing.some((reason) => reason.includes('localidad de origen no pudo resolverse')))

  const unknownDestination = calculateFit(profile, 'Administrativa', '', 'Zona Norte')
  assert.ok(unknownDestination)
  assert.ok(unknownDestination.missing.some((reason) => reason.includes('se conserva el aviso')))
})

test('matches English remote, hybrid, and in-person labels and maps Lever workplace types into Spanish descriptions', () => {
  const postings = leverArgentinaPayload([
    { text: 'Graphic Designer', country: 'AR', workplaceType: 'remote', descriptionPlain: 'Build design systems.' },
    { text: 'Product Analyst', country: 'AR', workplaceType: 'hybrid', descriptionPlain: 'Analyze product data.' },
    { text: 'Office Administrator', country: 'AR', workplaceType: 'on-site', descriptionPlain: 'Support the office team.' },
    { text: 'Role with unknown mode', country: 'AR', workplaceType: 'unspecified', descriptionPlain: 'Details pending.' },
  ])
  assert.ok(Array.isArray(postings))
  assert.match(String(postings[0].descriptionPlain), /^Modalidad de trabajo: remoto\./u)
  assert.match(String(postings[1].descriptionPlain), /^Modalidad de trabajo: híbrido\./u)
  assert.match(String(postings[2].descriptionPlain), /^Modalidad de trabajo: presencial\./u)
  assert.equal(postings[3].descriptionPlain, 'Details pending.')

  const profile = {
    id: 'mode', name: 'Remote roles', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'remoto', schedule: '',
    minimumSalary: null, minimumSalaryCurrency: 'ARS', active: true, createdAt: '', updatedAt: '',
  }
  const remoteFit = calculateFit(profile, 'Graphic Designer', String(postings[0].descriptionPlain), 'Argentina')
  assert.ok(remoteFit)
  assert.ok(remoteFit.reasons.includes('Menciona modalidad remoto'))
  const hybridFit = calculateFit({ ...profile, workMode: 'hibrido' }, 'Product Analyst', 'Hybrid workplace', 'Argentina')
  assert.ok(hybridFit)
  assert.ok(hybridFit.reasons.includes('Menciona modalidad híbrido'))
  const inPersonFit = calculateFit({ ...profile, workMode: 'presencial' }, 'Office Administrator', 'On-site, in person', 'Argentina')
  assert.ok(inPersonFit)
  assert.ok(inPersonFit.reasons.includes('Menciona modalidad presencial'))
  const leverOnSiteFit = calculateFit({ ...profile, workMode: 'presencial' }, 'Office Administrator', String(postings[2].descriptionPlain), 'Argentina')
  assert.ok(leverOnSiteFit)
  assert.ok(leverOnSiteFit.reasons.includes('Menciona modalidad presencial'))
})

test('confirms schedule terms and applies the optional strict schedule filter', () => {
  const profile = {
    id: 'schedule', name: 'Administración', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'indistinto', schedule: 'Jornada completa',
    minimumSalary: null, minimumSalaryCurrency: 'ARS', active: true, createdAt: '', updatedAt: '',
  }
  const partTime = calculateFit(profile, 'Administrativa', 'Jornada parcial', 'Argentina')
  assert.ok(partTime)
  assert.ok(partTime.missing.includes('No confirma el horario: Jornada completa'))

  const strictProfile = { ...profile, requireScheduleMatch: true }
  assert.equal(calculateFit(strictProfile, 'Administrativa', 'Jornada parcial', 'Argentina'), null)
  assert.ok(calculateFit(strictProfile, 'Administrativa', 'Tiempo completo', 'Argentina'))
  assert.ok(calculateFit({ ...strictProfile, schedule: '' }, 'Administrativa', '', 'Argentina'))

  const fullTime = calculateFit(profile, 'Administrativa', 'Tiempo completo', 'Argentina')
  assert.ok(fullTime)
  assert.ok(!fullTime.missing.includes('No confirma el horario: Jornada completa'))

  const rotatingSchedule = calculateFit({ ...profile, schedule: 'Turnos rotativos' }, 'Operadora', 'Se trabaja por turnos rotativos', 'Argentina')
  assert.ok(rotatingSchedule)
  assert.ok(!rotatingSchedule.missing.includes('No confirma el horario: Turnos rotativos'))

  const nineHourProfile = { ...profile, schedule: '9 horas' }
  const fortyHours = calculateFit(nineHourProfile, 'Operaria', 'Jornada completa, 40 horas semanales', 'Argentina')
  assert.ok(fortyHours)
  assert.ok(fortyHours.missing.includes('No confirma el horario: 9 horas'))
  const nineHours = calculateFit(nineHourProfile, 'Operaria', 'Jornada parcial, 9 horas', 'Argentina')
  assert.ok(nineHours)
  assert.ok(!nineHours.missing.includes('No confirma el horario: 9 horas'))

  const unrelatedNine = calculateFit(nineHourProfile, 'Administrativa', 'El edificio tiene 9 pisos y se trabajan 40 horas semanales', 'Argentina')
  assert.ok(unrelatedNine)
  assert.ok(unrelatedNine.missing.includes('No confirma el horario: 9 horas'))

  const hyphenatedNineHours = calculateFit(nineHourProfile, 'Operaria', 'Turnos de 9-hour shifts', 'Argentina')
  assert.ok(hyphenatedNineHours)
  assert.ok(!hyphenatedNineHours.missing.includes('No confirma el horario: 9 horas'))

  const attachedNineHourProfile = { ...nineHourProfile, schedule: '9h' }
  const attachedNineHours = calculateFit(attachedNineHourProfile, 'Operaria', 'Turno de 9-hour shifts', 'Argentina')
  assert.ok(attachedNineHours)
  assert.ok(!attachedNineHours.missing.includes('No confirma el horario: 9h'))
})

test('matches included and excluded keywords at word and phrase boundaries', () => {
  const profile = {
    id: 'keywords', name: 'Prueba', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: ['AI'], workMode: 'indistinto', schedule: '',
    minimumSalary: null, minimumSalaryCurrency: 'ARS', active: true, createdAt: '', updatedAt: '',
  }
  const emailSupport = calculateFit(profile, 'Email Support Specialist', 'Maintain customer email systems', 'Argentina')
  assert.ok(emailSupport)
  assert.equal(calculateFit(profile, 'AI Product Designer', '', 'Argentina'), null)

  const artProfile = { ...profile, excludeKeywords: [], includeKeywords: ['Art'] }
  const departmentRole = calculateFit(artProfile, 'Human Resources', 'Coordinate with the department team', 'Argentina')
  assert.ok(departmentRole)
  assert.ok(departmentRole.missing.includes('No se detectan estas palabras: Art'))
  const artDirector = calculateFit(artProfile, 'Art Director', 'Lead campaign art direction', 'Argentina')
  assert.ok(artDirector)
  assert.ok(artDirector.reasons.includes('Coincide con: Art'))

  const dataProfile = { ...profile, excludeKeywords: [], roles: ['Data Analyst'] }
  const hyphenatedTitle = calculateFit(dataProfile, 'Senior Data-Analyst', '', 'Argentina')
  assert.ok(hyphenatedTitle)
  assert.ok(hyphenatedTitle.reasons.includes('Menciona el puesto: Data Analyst'))
})

test('keeps package metadata and verified-source labels correctly encoded as UTF-8', () => {
  const packageText = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const appText = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const policiesText = fs.readFileSync(new URL('../src/shared/verified-source-policies.ts', import.meta.url), 'utf8')
  const packageMetadata = JSON.parse(packageText)
  assert.match(packageMetadata.description, /Búsqueda laboral/u)
  for (const text of [packageText, appText, policiesText]) {
    assert.doesNotMatch(text, /[ÃÂ][\u0080-\u00BF]/u)
  }
  assert.match(policiesText, /Avisos públicos de Despegar/u)
  assert.match(appText, /Agregué/u)
})

test('uses system focus and selection colors in forced-colors mode', () => {
  const styles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(styles, /@media\s*\(forced-colors:\s*active\)/u)
  assert.match(styles, /\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important;[^}]*transition:\s*none\s*!important;/su)
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight/su)
  assert.match(styles, /\.nav-item\.active,[\s\S]*?\.filter-tabs button\.selected\s*\{[^}]*background:\s*Highlight/su)
  assert.match(styles, /\.modal-card\s*\{[^}]*background:\s*Canvas/su)
})

test('announces transient app notices through one persistent polite status region', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /<div key=\{toast\.id\} className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">\{toast\.text\}<\/div>/u)
  assert.match(appSource, /<div className="toast-message" aria-hidden="true">/u)
})
test('dialogs expose their title to assistive readers and preferences show the app version', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /aria-labelledby=\{titleId\}/u)
  assert.match(appSource, /<h2 id=\{titleId\}>/u)
  assert.match(appSource, /Radar Laboral \{appVersion/u)
})

test('hydrates the current update state without clearing it during ordinary refreshes', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const refreshStart = appSource.indexOf('const refresh = useCallback(async () => {')
  const refreshEnd = appSource.indexOf('\n  }, [])', refreshStart)
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart)
  assert.doesNotMatch(appSource.slice(refreshStart, refreshEnd), /setUpdateState/u)

  const listenerIndex = appSource.indexOf('window.radar.app.onUpdateState')
  const statusIndex = appSource.indexOf('window.radar.app.updateStatus()', listenerIndex)
  assert.ok(listenerIndex >= 0 && statusIndex > listenerIndex)
  const effectStart = appSource.lastIndexOf('useEffect(() => {', listenerIndex)
  const effectEnd = appSource.indexOf('\n  }, [])', statusIndex)
  assert.ok(effectStart >= 0 && effectEnd > statusIndex)
  assert.match(appSource.slice(effectStart, effectEnd), /updateStateEventSequence\.current/u)
})

test('ordinary data refreshes do not overwrite unsaved preferences or candidate details', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const refreshStart = appSource.indexOf('const refresh = useCallback(async () => {')
  const refreshEnd = appSource.indexOf('\n  }, [])', refreshStart)
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart)
  const refreshSource = appSource.slice(refreshStart, refreshEnd)
  assert.doesNotMatch(refreshSource, /app\.settings\(\)|candidate\.get\(\)|setSettings\(|setCandidateProfile\(/u)

  const preferencesStart = appSource.indexOf('const loadPreferences = useCallback(async () => {')
  const preferencesEnd = appSource.indexOf('\n  }, [])', preferencesStart)
  assert.ok(preferencesStart >= 0 && preferencesEnd > preferencesStart)
  const preferencesSource = appSource.slice(preferencesStart, preferencesEnd)
  assert.match(preferencesSource, /window\.radar\.app\.settings\(\)/u)
  assert.match(preferencesSource, /window\.radar\.candidate\.get\(\)/u)
  assert.match(appSource, /Promise\.all\(\[refresh\(\), loadPreferences\(\)\]\)/u)
  assert.ok(/setSettings\(\(current\)\s*=>\s*\(\{ \.\.\.current, aiApiKeyConfigured: saved\.aiApiKeyConfigured \}\)\)/u.test(appSource))
  assert.ok(/setSettings\(\(current\)\s*=>\s*\(\{ \.\.\.current, salaryExchangeRates: refreshed\.salaryExchangeRates \}\)\)/u.test(appSource))
})

test('ignores JSON import previews after their file or mapping changes', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /const jsonImportPreviewSequence = useRef\(0\)/u)
  assert.match(appSource, /function invalidateJsonImportPreview\(\)\s*\{[^}]*jsonImportPreviewSequence\.current\s*\+=\s*1[^}]*setJsonImportPreview\(null\)[^}]*setPreviewingJsonImport\(false\)/su)

  const previewStart = appSource.indexOf('async function previewJsonOpportunities()')
  const previewEnd = appSource.indexOf('\n  async function testSource()', previewStart)
  assert.ok(previewStart >= 0 && previewEnd > previewStart)
  const previewSource = appSource.slice(previewStart, previewEnd)
  assert.match(previewSource, /const requestSequence = \+\+jsonImportPreviewSequence\.current/u)
  assert.match(previewSource, /if \(requestSequence === jsonImportPreviewSequence\.current\) setJsonImportPreview\(\{ result \}\)/u)
  assert.match(previewSource, /if \(requestSequence === jsonImportPreviewSequence\.current\) setPreviewingJsonImport\(false\)/u)
  assert.match(previewSource, /if \(requestSequence === jsonImportPreviewSequence\.current\) \{\s*setJsonImportPreview\(\{ error:/u)

  const fileStart = appSource.indexOf('async function selectJsonImportFile(')
  const fileEnd = appSource.indexOf('\n  async function previewJsonOpportunities()', fileStart)
  assert.ok(fileStart >= 0 && fileEnd > fileStart)
  const fileSource = appSource.slice(fileStart, fileEnd)
  assert.match(fileSource, /invalidateJsonImportPreview\(\)/u)
  assert.match(fileSource, /const requestSequence = \+\+jsonImportFileReadSequence\.current/u)
  assert.match(fileSource, /if \(requestSequence !== jsonImportFileReadSequence\.current\) return/u)
  assert.match(appSource, /setJsonImportSourceId\(event\.target\.value\); invalidateJsonImportPreview\(\)/u)
  assert.match(appSource, /setJsonImportProfileId\(event\.target\.value\); invalidateJsonImportPreview\(\)/u)
})

test('keeps the last selected CSV file when reads finish out of order', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /const csvImportFileReadSequence = useRef\(0\)/u)
  const fileStart = appSource.indexOf('async function selectCsvImportFile(')
  const fileEnd = appSource.indexOf('\n  async function selectJsonImportFile(', fileStart)
  assert.ok(fileStart >= 0 && fileEnd > fileStart)
  const fileSource = appSource.slice(fileStart, fileEnd)
  assert.match(fileSource, /const requestSequence = \+\+csvImportFileReadSequence\.current/u)
  assert.match(fileSource, /if \(requestSequence !== csvImportFileReadSequence\.current\) return/u)
  assert.match(appSource, /function openCsvImport\(\)\s*\{\s*csvImportFileReadSequence\.current\s*\+=\s*1/u)
})

test('removes Vite development hosts from the packaged Content Security Policy', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const developmentPlugin = createContentSecurityPolicyPlugin('serve')
  const productionPlugin = createContentSecurityPolicyPlugin('build')
  const developmentHtml = developmentPlugin.transformIndexHtml.handler(html)
  const productionHtml = productionPlugin.transformIndexHtml.handler(html)

  assert.match(developmentHtml, /connect-src 'self' http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173;/u)
  assert.match(productionHtml, /connect-src 'self';/u)
  assert.doesNotMatch(productionHtml, /127\.0\.0\.1:5173/u)
  assert.doesNotMatch(productionHtml, /ws:\/\//u)
})

test('paginates every Lever page, confirms exact page boundaries, and rejects incomplete or unstable lists', async () => {
  const makePage = (start, count) => Array.from({ length: count }, (_, index) => ({ id: `posting-${start + index}` }))
  const offsets = []
  const postings = await fetchAllLeverPostings(async (skip) => {
    offsets.push(skip)
    return skip === 0 ? makePage(0, 100) : skip === 100 ? makePage(100, 100) : makePage(200, 7)
  })
  assert.deepEqual(offsets, [0, 100, 200, 0])
  assert.equal(postings.length, 207)

  const fullPageOffsets = []
  const fullPages = await fetchAllLeverPostings(async (skip) => {
    fullPageOffsets.push(skip)
    return skip < 200 ? makePage(skip, 100) : []
  })
  assert.deepEqual(fullPageOffsets, [0, 100, 200, 0])
  assert.equal(fullPages.length, 200)

  await assert.rejects(fetchAllLeverPostings(async (skip) => skip === 0 ? makePage(0, 100) : [{ id: 'posting-99' }], 100), /supera el límite/u)
  await assert.rejects(fetchAllLeverPostings(async (skip) => skip === 0 ? makePage(0, 100) : [{ id: 'posting-99' }]), /repitió avisos/u)
  await assert.rejects(fetchAllLeverPostings(async () => makePage(0, 101)), /formato o tamaño/u)
  await assert.rejects(fetchAllLeverPostings(async () => [{ text: 'Missing stable id' }]), /sin identificador/u)
  let firstPageReadCount = 0
  await assert.rejects(fetchAllLeverPostings(async (skip) => {
    if (skip === 0) {
      firstPageReadCount += 1
      return makePage(firstPageReadCount === 1 ? 0 : 1000, 100)
    }
    return makePage(100, 3)
  }), /cambió la primera página/u)
  assert.equal(LEVER_MAX_POSTINGS, 2000)
})

test('Lever refuses to truncate more than 100 Argentina postings', () => {
  const payload = Array.from({ length: LEVER_MAX_ARGENTINA_POSTINGS + 1 }, (_, index) => ({
    id: `arg-${index}`, country: 'AR', text: `Role ${index}`, hostedUrl: `https://jobs.lever.co/example/${index}`,
  }))
  assert.throws(() => leverArgentinaPayload(payload), /más de 100 avisos argentinos/u)
})
test('Lever rejects postings whose links leave its public board', () => {
  const base = { id: 'ar-1', country: 'AR', text: 'Argentina role', hostedUrl: 'https://jobs.lever.co/example/ar-1' }
  assert.equal(Array.isArray(leverArgentinaPayload([{ ...base }])), true)
  assert.throws(() => leverArgentinaPayload([{ ...base, hostedUrl: 'http://jobs.lever.co/example/ar-1' }]), /tablero público|enlace inválido/u)
  assert.throws(() => leverArgentinaPayload([{ ...base, hostedUrl: 'https://jobs.example.com/ar-1' }]), /tablero público/u)
  assert.throws(() => leverArgentinaPayload([{ ...base, hostedUrl: 'https://user:pass@jobs.lever.co/example/ar-1' }]), /tablero público|enlace inválido/u)
})

test('Lever maps Argentina postings from later pages before applying the 100-result cap', () => {
  const config = validateJsonSourceConfig({ itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', filterPath: '/country', filterValue: 'AR' })
  const payload = Array.from({ length: 150 }, (_, index) => ({
    id: `page-${index}`, text: `Role ${index}`, hostedUrl: `https://jobs.lever.co/example/${index}`, country: 'US',
  }))
  payload[149] = { id: 'argentina-late', text: 'Argentina role on page two', hostedUrl: 'https://jobs.lever.co/example/ar', country: 'AR' }
  const mapped = mapJsonFeed(leverArgentinaPayload(payload), config, LEVER_MAX_POSTINGS)
  assert.deepEqual(mapped.map((item) => item.title), ['Argentina role on page two'])
})

test('Lever uses an exact reviewed secondary Argentina location label only for its approved board', () => {
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-doola-argentina-json-2026-10-09')
  assert.ok(policy)
  assert.deepEqual(policy.leverArgentinaLocationLabels, ['Remote in Argentina'])
  const config = validateJsonSourceConfig({ itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', locationPath: '/categories/location' })
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(policy, config))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(policy, { ...config, filterPath: '/country', filterValue: 'AR' }))
  const payload = [
    {
      id: 'doola-ar-secondary', text: 'Product Designer', hostedUrl: 'https://jobs.lever.co/doola/ar-secondary', country: 'BR',
      categories: { location: 'Remote in Latin America', allLocations: ['Remote in Latin America', 'Remote in Argentina', 'Remote in Chile'] },
    },
    {
      id: 'doola-no-ar', text: 'Tax Reviewer', hostedUrl: 'https://jobs.lever.co/doola/no-ar', country: 'BR',
      categories: { location: 'Remote in Latin America', allLocations: ['Remote in Latin America', 'Remote in Philippines'] },
    },
    {
      id: 'doola-ar-primary', text: 'Buenos Aires role', hostedUrl: 'https://jobs.lever.co/doola/ar-primary', country: 'AR',
      categories: { location: 'Buenos Aires', allLocations: ['Buenos Aires'] },
    },
    {
      id: 'doola-near-match', text: 'No exact label', hostedUrl: 'https://jobs.lever.co/doola/near-match', country: 'CL',
      categories: { location: 'Remote', allLocations: ['Argentina Remote'] },
    },
  ]
  const normalized = leverArgentinaPayload(payload, LEVER_MAX_ARGENTINA_POSTINGS, policy.leverArgentinaLocationLabels)
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].country, 'BR')
  assert.equal(normalized[0].categories.location, 'Remote in Argentina')
  assert.equal(normalized[0].categories.allLocations[0], 'Remote in Argentina')
  assert.deepEqual(mapJsonFeed(normalized, config, LEVER_MAX_POSTINGS).map((item) => item.location), ['Remote in Argentina', 'Buenos Aires'])
  const overCap = Array.from({ length: LEVER_MAX_ARGENTINA_POSTINGS + 1 }, (_, index) => ({
    id: `doola-ar-${index}`, country: 'BR', categories: { allLocations: ['Remote in Argentina'] },
  }))
  assert.throws(() => leverArgentinaPayload(overCap, LEVER_MAX_ARGENTINA_POSTINGS, policy.leverArgentinaLocationLabels), /avisos argentinos/u)
})

test('Sauce Lever policy accepts only the exact reviewed Argentina location label', () => {
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-sauce-argentina-json-2026-10-09')
  assert.ok(policy)
  assert.deepEqual(policy.leverArgentinaLocationLabels, ['Argentina'])
  const config = validateJsonSourceConfig({ itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', locationPath: '/categories/location' })
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(policy, config))
  const payload = [
    {
      id: 'sauce-argentina-secondary', text: 'People & Recruiting Specialist',
      hostedUrl: 'https://jobs.lever.co/Sauce/3b902ee6-4bd8-4079-8ffb-2265a766f06c', country: 'BR', workplaceType: 'remote',
      categories: { location: 'Brazil', allLocations: ['Brazil', 'Argentina', 'Colombia', 'Mexico'] },
    },
    {
      id: 'sauce-near-match', text: 'Regional recruiter', hostedUrl: 'https://jobs.lever.co/Sauce/near-match', country: 'BR',
      categories: { location: 'Brazil', allLocations: ['Brazil', 'Argentina Remote', 'Mexico'] },
    },
  ]
  const normalized = leverArgentinaPayload(payload, LEVER_MAX_ARGENTINA_POSTINGS, policy.leverArgentinaLocationLabels)
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].country, 'BR')
  assert.equal(normalized[0].categories.location, 'Argentina')
  assert.deepEqual(mapJsonFeed(normalized, config, LEVER_MAX_POSTINGS).map((item) => item.location), ['Argentina'])
  assert.match(normalized[0].descriptionPlain, /^Modalidad de trabajo: remoto\./u)
})

test('Appen Lever policy accepts Argentina only by country or its exact reviewed location label', () => {
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-appen-argentina-json-2026-10-09')
  assert.ok(policy)
  assert.equal(policy.url, 'https://api.lever.co/v0/postings/appen-2?mode=json&limit=100')
  assert.deepEqual(policy.leverArgentinaLocationLabels, ['Remote - Argentina'])
  assert.equal(policy.reviewedOn, '2026-10-09')
  const config = validateJsonSourceConfig({ itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', locationPath: '/categories/location' })
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(policy, config))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(policy, { ...config, filterPath: '/country', filterValue: 'AR' }))
  const payload = [
    {
      id: 'appen-argentina', text: 'Strategic Sourcing Lead – Fulfillment - Argentina',
      hostedUrl: 'https://jobs.lever.co/appen-2/572f0190-f7e8-4df0-952a-04172f96d775', country: 'AR', workplaceType: 'remote',
      categories: { location: 'Remote - Argentina', allLocations: ['Remote - Argentina', 'Remote, BR', 'Remote PH', 'Remote, MX'] },
    },
    {
      id: 'appen-brazil-title-mentions-argentina', text: 'Strategic Sourcer – Fulfillment - Argentina',
      hostedUrl: 'https://jobs.lever.co/appen-2/brazil-role', country: 'BR',
      categories: { location: 'Remote, BR', allLocations: ['Remote, BR', 'Remote PH'] },
    },
    {
      id: 'appen-near-label', text: 'Regional role', hostedUrl: 'https://jobs.lever.co/appen-2/near-label', country: 'BR',
      categories: { location: 'Remote, BR', allLocations: ['Remote Argentina', 'Remote - Arg'] },
    },
  ]
  const normalized = leverArgentinaPayload(payload, LEVER_MAX_ARGENTINA_POSTINGS, policy.leverArgentinaLocationLabels)
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].id, 'appen-argentina')
  assert.equal(normalized[0].categories.location, 'Remote - Argentina')
  assert.deepEqual(normalized[0].categories.allLocations, ['Remote - Argentina', 'Remote, BR', 'Remote PH', 'Remote, MX'])
  assert.match(normalized[0].descriptionPlain, /^Modalidad de trabajo: remoto\./u)
})

test('Anchorage Lever policy keeps Argentina only by country or its exact secondary location', () => {
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-anchorage-argentina-json-2026-10-09')
  assert.ok(policy)
  assert.equal(policy.url, 'https://api.lever.co/v0/postings/anchorage?mode=json&limit=100')
  assert.deepEqual(policy.leverArgentinaLocationLabels, ['Argentina'])
  assert.equal(policy.reviewedOn, '2026-10-09')
  assert.match(policy.scope, /inducción presencial/u)
  const config = validateJsonSourceConfig({ itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', locationPath: '/categories/location' })
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(policy, config))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(policy, { ...config, filterPath: '/country', filterValue: 'AR' }))
  const payload = [
    {
      id: 'anchorage-argentina-secondary', text: 'Derivatives Trader',
      hostedUrl: 'https://jobs.lever.co/anchorage/9f6d4223-389c-44e3-99b1-50f46c4855da', country: 'KY', workplaceType: 'remote',
      categories: { location: 'Cayman Islands', allLocations: ['Cayman Islands', 'Singapore', 'Brazil', 'Argentina'] },
    },
    {
      id: 'anchorage-argentina-primary', text: 'Member of Technical Staff',
      hostedUrl: 'https://jobs.lever.co/anchorage/argentina-primary', country: 'AR', workplaceType: 'remote',
      categories: { location: 'Argentina', allLocations: ['Argentina', 'Brazil'] },
    },
    {
      id: 'anchorage-title-only', text: 'Trader - Argentina',
      hostedUrl: 'https://jobs.lever.co/anchorage/title-only', country: 'KY', workplaceType: 'remote',
      categories: { location: 'Cayman Islands', allLocations: ['Cayman Islands', 'Argentina Remote'] },
    },
  ]
  const normalized = leverArgentinaPayload(payload, LEVER_MAX_ARGENTINA_POSTINGS, policy.leverArgentinaLocationLabels)
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].id, 'anchorage-argentina-secondary')
  assert.equal(normalized[0].country, 'KY')
  assert.equal(normalized[0].categories.location, 'Argentina')
  assert.deepEqual(mapJsonFeed(normalized, config, LEVER_MAX_POSTINGS).map((item) => item.location), ['Argentina', 'Argentina'])
  assert.match(normalized[0].descriptionPlain, /^Modalidad de trabajo: remoto\./u)
})

test('Bluelight policy retains all 105 Argentina postings within its reviewed source cap', async (context) => {
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-bluelightconsulting-argentina-json-2026-10-08')
  assert.ok(policy)
  assert.equal(policy.leverArgentinaMaxPostings, 200)
  const postings = Array.from({ length: 105 }, (_, index) => ({
    id: `bluelight-ar-${index}`,
    country: 'AR',
    text: `Role ${index}`,
    hostedUrl: `https://jobs.lever.co/bluelightconsulting/${index}`,
  }))
  assert.equal(Array.isArray(leverArgentinaPayload(postings, policy.leverArgentinaMaxPostings)), true)
  const atReviewedCap = Array.from({ length: 200 }, () => ({ country: 'AR' }))
  assert.equal(Array.isArray(leverArgentinaPayload(atReviewedCap, policy.leverArgentinaMaxPostings)), true)
  const beyondReviewedCap = Array.from({ length: 201 }, () => ({ country: 'AR' }))
  assert.throws(() => leverArgentinaPayload(beyondReviewedCap, policy.leverArgentinaMaxPostings), /200 avisos argentinos/u)

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-bluelight-cap-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const source = database.addSource({
    name: policy.sourceName ?? policy.title,
    url: policy.url,
    kind: 'json',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: policy.evidenceUrl,
    jsonConfig: {
      itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', descriptionPath: '', companyPath: '', locationPath: '',
      salaryPath: '', salaryMinimumPath: '', salaryMaximumPath: '', salaryCurrencyPath: '', salaryPeriodPath: '',
      publishedAtPath: '', filterPath: '/country', filterValue: 'AR',
    },
    csvConfig: null,
  })
  const items = postings.map((posting) => ({ title: posting.text, link: posting.hostedUrl, author: 'Bluelight Consulting' }))
  const result = await runSearch(database, { fetchSource: async () => items })
  assert.equal(source.automationApproved, true)
  assert.equal(result.errors.length, 0)
  assert.equal(result.added, 105)
  assert.equal(database.listOpportunities().length, 105)
  database.close()
})

test('compares monthly and annual salaries only when amount, period, and currency are explicit', () => {
  const profile = {
    id: 'salary',
    name: 'Administración',
    searchDescription: '',
    roles: [],
    locations: [],
    radiusKm: 0,
    includeKeywords: [],
    excludeKeywords: [],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: 1_000_000,
    minimumSalaryCurrency: 'ARS',
    active: true,
    createdAt: '',
    updatedAt: '',
  }

  assert.deepEqual(parseMonthlySalary('ARS 1.200.000 a 1.500.000 por mes'), { currency: 'ARS', lowerBound: 1_200_000, upperBound: 1_500_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('USD 1,250.50 monthly'), { currency: 'USD', lowerBound: 1_250.5, upperBound: 1_250.5, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('Euros 2.100 mensais'), { currency: 'EUR', lowerBound: 2_100, upperBound: 2_100, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('CAD 4,200 monthly'), { currency: 'CAD', lowerBound: 4_200, upperBound: 4_200, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('5,000 Canadian dollars monthly'), { currency: 'CAD', lowerBound: 5_000, upperBound: 5_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('4.500 dólares australianos mensuales'), { currency: 'AUD', lowerBound: 4_500, upperBound: 4_500, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('USD 2.5K–3K monthly'), { currency: 'USD', lowerBound: 2_500, upperBound: 3_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('ARS 1,2M mensuales'), { currency: 'ARS', lowerBound: 1_200_000, upperBound: 1_200_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('ARS 18.000.000 a 24.000.000 por año'), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 2_000_000, sourcePeriod: 'annual' })
  assert.deepEqual(parseMonthlySalary('USD 60K–72K annually'), { currency: 'USD', lowerBound: 5_000, upperBound: 6_000, sourcePeriod: 'annual' })
  assert.deepEqual(parseMonthlySalary('EUR 24,000 per year'), { currency: 'EUR', lowerBound: 2_000, upperBound: 2_000, sourcePeriod: 'annual' })
  assert.deepEqual(parseMonthlySalary('ARS 18,000,000 per annum'), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 1_500_000, sourcePeriod: 'annual' })
  assert.deepEqual(parseMonthlySalary('ARS 120.000 por semana'), { currency: 'ARS', lowerBound: 520_000, upperBound: 520_000, sourcePeriod: 'weekly' })
  assert.deepEqual(parseMonthlySalary('USD 900–1,200 weekly'), { currency: 'USD', lowerBound: 3_900, upperBound: 5_200, sourcePeriod: 'weekly' })
  assert.deepEqual(parseMonthlySalary('ARS 40.000 por día', { workDaysPerWeek: 5 }), { currency: 'ARS', lowerBound: 866_666.67, upperBound: 866_666.67, sourcePeriod: 'daily' })
  assert.deepEqual(parseMonthlySalary('USD 30 per hour', { workHoursPerWeek: 40 }), { currency: 'USD', lowerBound: 5_200, upperBound: 5_200, sourcePeriod: 'hourly' })
  assert.deepEqual(parseMonthlySalary('ARS 1.500.000 mensuales; 3 years of experience'), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 1_500_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('ARS 1.500.000 /month'), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 1_500_000, sourcePeriod: 'monthly' })
  assert.deepEqual(parseMonthlySalary('ARS 2.5M /month'), { currency: 'ARS', lowerBound: 2_500_000, upperBound: 2_500_000, sourcePeriod: 'monthly' })
  assert.equal(normalizeSalaryCurrency('pesos mexicanos'), 'MXN')
  assert.equal(normalizeSalaryCurrency('coronas suecas'), 'SEK')
  assert.equal(normalizeSalaryCurrency('dólares de Hong Kong'), 'HKD')
  assert.equal(normalizeSalaryCurrency('yuan chino offshore'), 'CNH')
  assert.equal(normalizeSalaryCurrency('yuanes chinos'), 'CNY')
  assert.deepEqual(parseMonthlySalary('VND 1.000.000 monthly'), { currency: 'VND', lowerBound: 1_000_000, upperBound: 1_000_000, sourcePeriod: 'monthly' })
  assert.equal(normalizeSalaryCurrency('$'), null)
  assert.equal(normalizeSalaryPeriod('por mês'), 'monthly')
  assert.equal(normalizeSalaryPeriod('por año'), 'annual')
  assert.equal(normalizeSalaryPeriod('per annum'), 'annual')
  assert.equal(normalizeSalaryPeriod('semanalmente'), 'weekly')
  assert.equal(normalizeSalaryPeriod('quincenal'), 'fortnightly')
  assert.equal(normalizeSalaryPeriod('por quincena'), 'fortnightly')
  assert.deepEqual(parseMonthlySalary('ARS 750.000 quincenales'), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 1_500_000, sourcePeriod: 'fortnightly' })

  assert.equal(parseSalaryAmount('1.200.000'), 1_200_000)
  assert.equal(parseSalaryAmount('1,200.50'), 1_200.5)
  assert.equal(parseSalaryAmount('2.5K'), 2_500)
  assert.equal(parseSalaryAmount('1.2M'), 1_200_000)
  assert.equal(parseSalaryAmount('1e6'), null)
  assert.equal(parseMonthlySalary('$ 1.500.000 por mes'), null)
  assert.equal(parseMonthlySalary('ARS o USD 1.500 mensuales'), null)
  assert.equal(parseMonthlySalary('ARS 18.000.000 por mes y 216.000.000 por año'), null)
  assert.equal(parseMonthlySalary('ARS 120.000 por semana y 480.000 por mes'), null)
  assert.equal(parseMonthlySalary('ARS 40.000 por día'), null)
  assert.equal(parseMonthlySalary('USD 30 hourly'), null)

  assert.ok(calculateFit(profile, 'Administrativa', '', '', 'ARS 1.200.000 mensuales'))
  const strictSalaryProfile = { ...profile, requireSalaryMatch: true }
  assert.equal(calculateFit(strictSalaryProfile, 'Administrativa', '', '', ''), null)
  assert.ok(calculateFit(profile, 'Administrativa', '', '', ''))
  assert.ok(calculateFit(strictSalaryProfile, 'Administrativa', '', '', 'ARS 1.200.000 mensuales'))
  assert.equal(calculateFit(strictSalaryProfile, 'Administrativa', '', '', 'ARS 950.000 a 1.200.000 por mes'), null)
  assert.equal(calculateFit(strictSalaryProfile, 'Administrativa', '', '', 'USD 1.500 monthly'), null)
  const dailySalary = calculateFit(profile, 'Administrativa', '', '', 'ARS 40.000 por día')
  assert.ok(dailySalary)
  assert.ok(dailySalary.missing.some((reason) => reason.includes('días remunerados por semana')))
  assert.equal(calculateFit({ ...strictSalaryProfile, workDaysPerWeek: null }, 'Administrativa', '', '', 'ARS 40.000 por día'), null)
  const configuredDailyProfile = { ...profile, workDaysPerWeek: 5, minimumSalary: 800_000 }
  assert.ok(calculateFit(configuredDailyProfile, 'Administrativa', '', '', 'ARS 40.000 por día')?.reasons.some((reason) => reason.includes('sueldo diario publicado')))
  const hourlyFit = calculateFit({ ...profile, workHoursPerWeek: 40, minimumSalary: 5_000, minimumSalaryCurrency: 'USD' }, 'Analista', '', '', 'USD 30 per hour')
  assert.ok(hourlyFit?.reasons.some((reason) => reason.includes('sueldo por hora publicado')))
  const dailyCrossing = calculateFit({ ...configuredDailyProfile, minimumSalary: 900_000 }, 'Administrativa', '', '', 'ARS 40.000 a 45.000 por día')
  assert.ok(dailyCrossing)
  assert.ok(dailyCrossing.missing.some((reason) => reason.includes('rango salarial incluye importes por debajo')))
  assert.ok(calculateFit(profile, 'Administrativa', '', '', 'ARS 250.000 por semana')?.reasons.some((reason) => reason.includes('52 semanas')))
  assert.equal(calculateFit(profile, 'Administrativa', '', '', 'ARS 230.000 por semana'), null)
  const weeklyCrossing = calculateFit({ ...profile, minimumSalary: 1_100_000 }, 'Administrativa', '', '', 'ARS 250.000 a 260.000 por semana')
  assert.ok(weeklyCrossing)
  assert.ok(weeklyCrossing.missing.some((reason) => reason.includes('rango salarial incluye importes por debajo')))
  assert.equal(calculateFit(profile, 'Administrativa', '', '', 'ARS 950.000 por mes'), null)
  const differentCurrency = calculateFit(profile, 'Administrativa', '', '', 'USD 1.500 monthly')
  assert.ok(differentCurrency)
  assert.ok(differentCurrency.missing.some((reason) => reason.includes('no se compara con el mínimo en ARS')))
  const missingCurrency = calculateFit(profile, 'Administrativa', '', '', '$ 1.500.000 mensuales')
  assert.ok(missingCurrency)
  const euroProfile = { ...profile, minimumSalary: 2_000, minimumSalaryCurrency: 'EUR' }
  assert.ok(calculateFit(euroProfile, 'Analista', '', '', 'EUR 2.500 por mes'))
  const usdProfile = { ...profile, minimumSalary: 2_000, minimumSalaryCurrency: 'USD' }
  const abbreviatedUsdSalary = 'USD 2.5K–3K monthly'
  assert.ok(calculateFit(usdProfile, 'Analista', '', '', abbreviatedUsdSalary))
  const crossingRange = calculateFit({ ...usdProfile, minimumSalary: 2_600 }, 'Analista', '', '', abbreviatedUsdSalary)
  assert.ok(crossingRange)
  assert.equal(calculateFit({ ...usdProfile, minimumSalary: 2_600, requireSalaryMatch: true }, 'Analista', '', '', abbreviatedUsdSalary), null)
  assert.ok(crossingRange.missing.includes('El rango salarial incluye importes por debajo del mínimo de USD; se conserva sin confirmar'))
  assert.ok(!crossingRange.reasons.some((reason) => reason.includes('alcanza el mínimo')))
  assert.equal(calculateFit({ ...usdProfile, minimumSalary: 3_100 }, 'Analista', '', '', abbreviatedUsdSalary), null)
  const differentCurrencyForEuro = calculateFit(euroProfile, 'Analista', '', '', 'USD 3.000 monthly')
  assert.ok(differentCurrencyForEuro)
  assert.ok(differentCurrencyForEuro.missing.some((reason) => reason.includes('EUR')))
  assert.ok(missingCurrency.missing.some((reason) => reason.includes('no se aplicó el mínimo de ARS')))
})

test('uses current BCRA reference rates only when a profile opts in and the currency is covered', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-fx-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const now = new Date()
  const asOf = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const staleAsOf = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const responseBody = {
    status: 200,
    results: {
      fecha: asOf,
      detalle: [
        { codigoMoneda: 'ARS', tipoCotizacion: 0 },
        { codigoMoneda: 'USD', tipoCotizacion: 1500 },
        { codigoMoneda: 'EUR', tipoCotizacion: 1700 },
        { codigoMoneda: 'AWG', tipoCotizacion: 846.64 },
        { codigoMoneda: 'VND', tipoCotizacion: 58.439054 },
        { codigoMoneda: 'MXP', descripcion: 'PESO MEXICANO', tipoCotizacion: 83 },
        { codigoMoneda: 'VEB', tipoCotizacion: 1.7 },
        { codigoMoneda: 'REF', tipoCotizacion: 1518 },
        { codigoMoneda: 'XDR', tipoCotizacion: 2000 },
        { codigoMoneda: 'XAG', tipoCotizacion: 0 },
        { codigoMoneda: 'XAU', tipoCotizacion: 0 },
      ],
    },
  }
  let request
  const rates = await fetchBcraSalaryExchangeRates(async (url, options) => {
    request = { url: String(url), options }
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } })
  }, now)
  assert.equal(request.url, 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones')
  assert.equal(request.options.redirect, 'error')
  assert.deepEqual(rates.arsPerUnit, { ARS: 1, USD: 1500, EUR: 1700, AWG: 846.64, VND: 0.058439054, MXN: 83 })
  const mislabeledMxp = { ...responseBody, results: { ...responseBody.results, detalle: responseBody.results.detalle.map((quote) =>
    quote.codigoMoneda === 'MXP' ? { ...quote, descripcion: 'PESO ANTERIOR' } : quote,
  ) } }
  assert.equal(parseBcraSalaryExchangeRates(mislabeledMxp, now).arsPerUnit.MXN, undefined, 'Radar ignores the MXP alias if BCRA changes its denomination')
  const canonicalMxn = { ...responseBody, results: { ...responseBody.results, detalle: [
    { codigoMoneda: 'MXN', tipoCotizacion: 84 },
    ...responseBody.results.detalle,
  ] } }
  assert.equal(parseBcraSalaryExchangeRates(canonicalMxn, now).arsPerUnit.MXN, 84, 'The canonical MXN quote wins even if the BCRA MXP alias follows it')
  const canonicalMxnLast = { ...responseBody, results: { ...responseBody.results, detalle: [
    ...responseBody.results.detalle,
    { codigoMoneda: 'MXN', tipoCotizacion: 85 },
  ] } }
  assert.equal(parseBcraSalaryExchangeRates(canonicalMxnLast, now).arsPerUnit.MXN, 85, 'The canonical MXN quote replaces the alias when it follows it')
  assert.equal(calculateFit({
    id: 'vnd-fx', name: 'Analista', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'indistinto', schedule: '',
    minimumSalary: 60_000, minimumSalaryCurrency: 'ARS', convertSalaryCurrencies: true, active: true,
    createdAt: '', updatedAt: '',
  }, 'Analista', '', '', 'VND 1.000.000 monthly', rates), null)
  assert.equal(rates.asOf, asOf)
  assert.throws(() => parseBcraSalaryExchangeRates({ ...responseBody, results: { ...responseBody.results, fecha: staleAsOf } }, now), /vencida/u)

  const profile = {
    id: 'fx', name: 'Administración', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'indistinto', schedule: '',
    minimumSalary: 1_400_000, minimumSalaryCurrency: 'ARS', convertSalaryCurrencies: true, active: true,
    createdAt: '', updatedAt: '',
  }
  const match = calculateFit(profile, 'Administrativa', '', '', 'USD 1,000 monthly', rates)
  assert.ok(match)
  assert.ok(match.reasons.some((reason) => reason.includes(`referencia BCRA del ${asOf}`)))
  const weeklyMatch = calculateFit(profile, 'Administrativa', '', '', 'USD 250 weekly', rates)
  assert.ok(weeklyMatch)
  assert.ok(weeklyMatch.reasons.some((reason) => reason.includes('sueldo semanal anualizado con 52 semanas')))
  assert.ok(weeklyMatch.reasons.some((reason) => reason.includes(`referencia BCRA del ${asOf}`)))
  assert.equal(calculateFit({ ...profile, minimumSalary: 1_400_000 }, 'Administrativa', '', '', 'USD 900 monthly', rates), null)
  assert.ok(calculateFit({ ...profile, requireSalaryMatch: true }, 'Administrativa', '', '', 'USD 1,000 monthly', rates))
  const mxnMinimum = { ...profile, minimumSalary: 16_000, minimumSalaryCurrency: 'MXN', requireSalaryMatch: true }
  const mxnMatch = calculateFit(mxnMinimum, 'Administrativa', '', '', 'USD 1,000 monthly', rates)
  assert.ok(mxnMatch)
  assert.ok(mxnMatch.reasons.some((reason) => reason.includes(`referencia BCRA del ${asOf}`)))
  assert.equal(calculateFit({ ...mxnMinimum, minimumSalary: 19_000 }, 'Administrativa', '', '', 'USD 1,000 monthly', rates), null)
  const crossingRange = calculateFit({ ...profile, minimumSalary: 1_600_000 }, 'Administrativa', '', '', 'USD 1,000–1,100 monthly', rates)
  assert.ok(crossingRange)
  assert.ok(crossingRange.missing.some((reason) => reason.includes('rango convertido')))
  const unavailableCurrency = calculateFit({ ...profile, minimumSalaryCurrency: 'CAD' }, 'Administrativa', '', '', 'USD 1,000 monthly', rates)
  assert.ok(unavailableCurrency)
  assert.ok(unavailableCurrency.missing.some((reason) => reason.includes('cotización BCRA vigente')))

  const database = new RadarDatabase(directory)
  database.saveProfile(profile)
  database.saveSalaryExchangeRates(rates)
  assert.deepEqual(database.settings().salaryExchangeRates, rates)
  const policy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.id === 'lever-bluelightconsulting-argentina-json-2026-10-08')
  assert.ok(policy)
  database.addSource({
    name: policy.sourceName ?? policy.title,
    url: policy.url,
    kind: 'json',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: policy.evidenceUrl,
    jsonConfig: {
      itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', descriptionPath: '', companyPath: '', locationPath: '',
      salaryPath: '', salaryMinimumPath: '', salaryMaximumPath: '', salaryCurrencyPath: '', salaryPeriodPath: '',
      publishedAtPath: '', filterPath: '/country', filterValue: 'AR',
    },
    csvConfig: null,
  })
  let exchangeRateCalls = 0
  const search = await runSearch(database, {
    fetchSource: async () => [{ title: 'Administrativa', link: 'https://jobs.lever.co/bluelightconsulting/fx-test', salary: 'USD 1000 monthly' }],
    getSalaryExchangeRates: async () => {
      exchangeRateCalls += 1
      return rates
    },
  })
  assert.equal(exchangeRateCalls, 1)
  assert.equal(search.added, 1)
  assert.ok(database.listOpportunities()[0].matchReasons.some((reason) => reason.includes(`referencia BCRA del ${asOf}`)))
  let called = false
  const cached = await currentSalaryExchangeRates(database, async () => {
    called = true
    throw new Error('No debe consultar una cotización actualizada hace unas horas.')
  }, now)
  assert.equal(called, false)
  assert.deepEqual(cached, rates)

  const refreshDueSnapshot = { ...rates, fetchedAt: new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString() }
  database.saveSalaryExchangeRates(refreshDueSnapshot)
  let failedRefreshAttempted = false
  const fallbackSnapshot = await currentSalaryExchangeRates(database, async () => {
    failedRefreshAttempted = true
    throw new Error('BCRA fuera de servicio durante la renovación simulada.')
  }, now)
  assert.equal(failedRefreshAttempted, true)
  assert.deepEqual(fallbackSnapshot, refreshDueSnapshot)

  const withoutCachedRates = new RadarDatabase(path.join(directory, 'without-cached-rates'))
  const noSnapshot = await currentSalaryExchangeRates(withoutCachedRates, async () => {
    throw new Error('BCRA fuera de servicio sin caché disponible.')
  }, now)
  assert.equal(noSnapshot, null)
  const withoutRatesMatch = calculateFit(profile, 'Administrativa', '', '', 'USD 1,000 monthly', noSnapshot)
  assert.ok(withoutRatesMatch)
  assert.ok(withoutRatesMatch.missing.some((reason) => reason.includes('No hay una cotización BCRA vigente')))
  withoutCachedRates.close()
  database.close()
})

test('validates local application dates and bounds private tracking notes', () => {
  assert.deepEqual(validateOpportunityTracking({
    appliedDate: '2026-10-08',
    followUpDate: '2026-10-15',
    trackingNotes: '  Entrevista confirmada.  ',
  }), {
    appliedDate: '2026-10-08',
    followUpDate: '2026-10-15',
    trackingNotes: 'Entrevista confirmada.',
  })
  assert.deepEqual(validateOpportunityTracking({ appliedDate: '', followUpDate: null, trackingNotes: '' }), {
    appliedDate: null,
    followUpDate: null,
    trackingNotes: '',
  })
  assert.throws(() => validateOpportunityTracking({ appliedDate: '2026-02-30', followUpDate: null, trackingNotes: '' }), /fecha válida/u)
  assert.deepEqual(validateOpportunityTracking({ appliedDate: undefined, followUpDate: undefined, trackingNotes: '' }), {
    appliedDate: null,
    followUpDate: null,
    trackingNotes: '',
  })
  assert.throws(() => validateOpportunityTracking({ appliedDate: null, followUpDate: null, trackingNotes: 'x'.repeat(5001) }), /5000/u)
  assert.equal(validateOpportunityTracking({ appliedDate: null, followUpDate: null, trackingNotes: `${'x'.repeat(4999)}  ` }).trackingNotes, 'x'.repeat(4999))
})

test('persists profiles, candidate facts, drafts and opportunity status without duplicating a vacancy', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-db-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const profile = {
    name: 'Atención al cliente',
    searchDescription: 'Atención presencial y telefónica en Santa Fe',
    roles: ['Atención al cliente'],
    locations: ['Santa Fe'],
    radiusKm: 25,
    includeKeywords: ['jornada completa'],
    excludeKeywords: ['solo comisión'],
    workMode: 'presencial',
    schedule: 'Jornada completa',
    minimumSalary: null,
    minimumSalaryCurrency: 'ARS',
    active: true,
  }
  const candidate = {
    fullName: 'Persona de prueba',
    email: 'persona@example.com',
    phone: '',
    location: 'Santa Fe',
    availability: 'Inmediata',
    mobility: '',
    summary: 'Datos ficticios de prueba.',
    additionalFacts: '',
  }
  const vacancy = {
    profileId: null,
    title: 'Atención al cliente',
    company: 'Empresa de prueba',
    location: 'Santa Fe',
    source: 'Prueba',
    url: 'https://example.com/jobs/1',
    description: 'Aviso de prueba.',
    salaryText: '',
    matchScore: 80,
    matchReasons: ['Coincide el puesto'],
    missingRequirements: [],
  }

  const database = new RadarDatabase(directory)
  const savedProfile = database.saveProfile({ ...profile, minimumSalary: 500_000, convertSalaryCurrencies: true, requireScheduleMatch: true, requireSalaryMatch: true, workDaysPerWeek: 5, workHoursPerWeek: 40 })
  database.saveCandidateProfile(candidate)
  const savedVacancy = database.addOpportunity(vacancy)
  assert.equal(database.addOpportunityIfNew(vacancy), null)
  database.saveDraft({ opportunityId: savedVacancy.id, resumeId: null, message: 'Mensaje editable.', resumeCopyText: '' })
  database.updateOpportunityStatus(savedVacancy.id, 'postulada')
  const tracked = database.updateOpportunityTracking(savedVacancy.id, {
    appliedDate: '2026-10-07',
    followUpDate: '2026-10-14',
    trackingNotes: 'Llamar si no responden.',
  })
  assert.equal(tracked.appliedDate, '2026-10-07')
  assert.equal(tracked.followUpDate, '2026-10-14')
  assert.equal(tracked.trackingNotes, 'Llamar si no responden.')
  assert.equal(database.updateOpportunityStatus(savedVacancy.id, 'guardada').appliedDate, '2026-10-07')
  database.updateOpportunityStatus(savedVacancy.id, 'postulada')
  database.close()

  const reopened = new RadarDatabase(directory)
  assert.equal(reopened.listProfiles()[0].id, savedProfile.id)
  assert.equal(reopened.listProfiles()[0].minimumSalaryCurrency, 'ARS')
  assert.equal(reopened.listProfiles()[0].convertSalaryCurrencies, true)
  assert.equal(reopened.listProfiles()[0].workDaysPerWeek, 5)
  assert.equal(reopened.listProfiles()[0].workHoursPerWeek, 40)
  assert.equal(reopened.listProfiles()[0].requireScheduleMatch, true)
  assert.equal(reopened.listProfiles()[0].requireSalaryMatch, true)
  assert.equal(reopened.candidateProfile().email, candidate.email)
  assert.equal(reopened.listOpportunities().length, 1)
  assert.equal(reopened.getOpportunity(savedVacancy.id).status, 'postulada')
  assert.equal(reopened.getOpportunity(savedVacancy.id).appliedDate, '2026-10-07')
  assert.equal(reopened.getOpportunity(savedVacancy.id).followUpDate, '2026-10-14')
  assert.equal(reopened.getOpportunity(savedVacancy.id).trackingNotes, 'Llamar si no responden.')
  assert.equal(reopened.listDrafts()[0].message, 'Mensaje editable.')
  reopened.close()
})

test('backs up and restores the SQLite data and original PDF files with validation before replacement', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-backup-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const userData = path.join(directory, 'app-data')
  const backupParent = path.join(directory, 'backups')
  fs.mkdirSync(backupParent)
  const database = new RadarDatabase(userData)
  const savedProfile = database.saveProfile({
    name: 'Administración',
    searchDescription: '',
    roles: ['Administrativa'],
    locations: ['Rosario'],
    radiusKm: 25,
    includeKeywords: [],
    excludeKeywords: [],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: null,
    minimumSalaryCurrency: 'ARS',
    active: true,
  })
  const pdfBytes = Buffer.from('%PDF-1.7\nCV de respaldo')
  const resume = database.addResume({ name: 'CV administración', originalName: 'administracion.pdf', pageCount: 1, extractedText: 'Experiencia administrativa', bytes: pdfBytes })
  const orphanResumeId = '00000000-0000-4000-8000-000000000001'
  fs.writeFileSync(path.join(userData, 'resumes', `${orphanResumeId}.pdf`), Buffer.from('%PDF-1.7\nArchivo sin registro'))
  const opportunity = database.addOpportunity({
    profileId: savedProfile.id,
    title: 'Administrativa',
    company: 'Empresa de prueba',
    location: 'Rosario',
    source: 'Manual',
    url: 'https://example.com/backup-job',
    description: '',
    salaryText: '',
  })
  database.updateOpportunityStatus(opportunity.id, 'postulada')
  database.updateOpportunityTracking(opportunity.id, {
    appliedDate: '2026-10-06',
    followUpDate: '2026-10-13',
    trackingNotes: 'Revisar respuesta del equipo.',
  })
  database.saveDraft({ opportunityId: opportunity.id, resumeId: resume.id, message: 'Borrador local', resumeCopyText: 'CV editable' })
  database.saveAiApiKeyEncrypted('cifrado-de-prueba')

  const backupPath = await database.createBackup(backupParent, '0.3.0')
  const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8'))
  assert.equal(manifest.format, 'radar-laboral-backup')
  assert.equal(manifest.appVersion, '0.3.0')
  assert.deepEqual(fs.readdirSync(path.join(backupPath, 'resumes')), [`${resume.id}.pdf`])
  assert.equal(fs.readFileSync(path.join(backupPath, 'resumes', `${resume.id}.pdf`)).toString(), pdfBytes.toString())

  const brokenBackup = path.join(directory, 'broken-backup')
  fs.cpSync(backupPath, brokenBackup, { recursive: true })
  fs.rmSync(path.join(brokenBackup, 'resumes', `${resume.id}.pdf`))
  await assert.rejects(database.restoreBackup(brokenBackup), /no coinciden|PDF/)
  assert.equal(database.listProfiles().length, 1)
  assert.equal(database.listResumes().length, 1)

  database.saveProfile({
    name: 'Perfil temporal', searchDescription: '', roles: [], locations: ['Córdoba'], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'indistinto', schedule: '', minimumSalary: null,
    minimumSalaryCurrency: 'USD', active: true,
  })
  database.removeResume(resume.id)
  await database.restoreBackup(backupPath)

  assert.deepEqual(database.listProfiles().map((profile) => profile.name), ['Administración'])
  assert.equal(database.listResumes().length, 1)
  assert.equal(database.listDrafts()[0].resumeId, resume.id)
  assert.deepEqual(
    (({ appliedDate, followUpDate, trackingNotes }) => ({ appliedDate, followUpDate, trackingNotes }))(database.getOpportunity(opportunity.id)),
    { appliedDate: '2026-10-06', followUpDate: '2026-10-13', trackingNotes: 'Revisar respuesta del equipo.' },
  )
  assert.equal(database.aiApiKeyEncrypted(), 'cifrado-de-prueba')
  const restoredFile = path.join(userData, 'resumes', `${resume.id}.pdf`)
  assert.deepEqual(fs.readFileSync(restoredFile), pdfBytes)
  const inspection = new Database(path.join(userData, 'radar-laboral.sqlite'), { readonly: true })
  assert.equal(inspection.prepare('SELECT stored_path FROM resumes WHERE id = ?').get(resume.id).stored_path, restoredFile)
  assert.equal(inspection.pragma('integrity_check')[0].integrity_check, 'ok')
  inspection.close()
  database.close()
})

test('tracks source health and requires explicit consent for custom automatic feeds', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-source-health-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const database = new RadarDatabase(directory)
  const source = database.addSource({
    name: 'Test feed',
    url: 'https://findjobit.com/jobs/country/argentina/feed',
    kind: 'rss',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: '',
  })
  assert.equal(source.lastAttemptAt, null)
  assert.equal(source.lastError, null)
  assert.equal(database.enabledSources().length, 1)

  const assistedSource = database.addSource({
    name: 'Unreviewed feed',
    url: 'https://example.org/jobs.xml',
    kind: 'rss',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: 'https://example.org/terms',
  })
  assert.equal(assistedSource.enabled, false)
  assert.equal(assistedSource.automationApproved, false)
  assert.equal(assistedSource.customAutomationApproved, false)
  assert.throws(() => database.updateSourceEnabled(assistedSource.id, true), /autorizás las consultas/u)
  const authorizedAssistedSource = database.updateCustomAutomationApproval(assistedSource.id, true)
  assert.equal(authorizedAssistedSource.customAutomationApproved, true)
  assert.equal(authorizedAssistedSource.enabled, false)
  assert.equal(database.updateSourceEnabled(assistedSource.id, true).enabled, true)
  const revokedSource = database.updateCustomAutomationApproval(assistedSource.id, false)
  assert.equal(revokedSource.customAutomationApproved, false)
  assert.equal(revokedSource.enabled, false)
  assert.equal(database.enabledSources().some((item) => item.id === assistedSource.id), false)
  const reauthorizedSource = database.updateCustomAutomationApproval(assistedSource.id, true)
  assert.equal(reauthorizedSource.customAutomationApproved, true)
  assert.equal(reauthorizedSource.enabled, false)
  assert.equal(database.enabledSources().some((item) => item.id === assistedSource.id), false)

  const result = await runSearch(database, { fetchSource: async () => { throw new Error('fallo simulado') } })
  assert.equal(result.checkedSources, 1)
  assert.equal(result.errors.length, 1)
  const failed = database.listSources().find((item) => item.id === source.id)
  assert.ok(failed.lastAttemptAt)
  assert.equal(failed.lastCheckedAt, null)
  assert.equal(failed.lastError, 'fallo simulado')

  const recoveredResult = await runSearch(database, { fetchSource: async () => [] })
  assert.equal(recoveredResult.checkedSources, 1)
  const recovered = database.listSources().find((item) => item.id === source.id)
  assert.ok(recovered.lastAttemptAt)
  assert.equal(recovered.lastCheckedAt, recovered.lastAttemptAt)
  assert.equal(recovered.lastError, null)

  database.updateSourceEnabled(source.id, false)
  const customSource = database.addSource({
    name: 'Feed propio autorizado',
    url: 'https://example.org/custom-jobs.xml',
    kind: 'rss',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: 'https://example.org/terms',
  })
  assert.equal(customSource.enabled, true)
  assert.equal(customSource.automationApproved, false)
  assert.equal(customSource.customAutomationApproved, true)
  assert.throws(() => database.updateCustomAutomationApproval(source.id, true), /pol.tica verificada/u)
  assert.deepEqual(database.enabledSources().map((item) => item.id), [customSource.id])
  const customSearch = await runSearch(database, {
    fetchSource: async (activeSource) => {
      assert.equal(activeSource.id, customSource.id)
      return []
    },
  })
  assert.equal(customSearch.checkedSources, 1)
  assert.deepEqual(customSearch.errors, [])
  database.updateSourceEnabled(customSource.id, false)
  database.close()

  const reopened = new RadarDatabase(directory)
  const persistedCustomSource = reopened.listSources().find((item) => item.id === customSource.id)
  assert.equal(persistedCustomSource.customAutomationApproved, true)
  assert.equal(persistedCustomSource.enabled, false)
  assert.equal(reopened.updateSourceEnabled(customSource.id, true).enabled, true)
  reopened.close()
})

test('discloses the request and requires affirmative consent for a custom feed', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /Confirmo que este endpoint público permite consultas automáticas y autorizo a Radar/u)
  assert.match(appSource, /El servidor verá tu dirección IP; Radar no le envía tu perfil, CV ni filtros/u)
  assert.match(appSource, /customAutomationApproved: !findVerifiedSourcePolicy\(sourceForm\.kind, sourceForm\.url\) && sourceForm\.customAutomationApproved/u)
  assert.match(appSource, /updateCustomAutomationApproval/u)
  assert.match(appSource, /Revocar autorización/u)
  assert.match(appSource, /Autorizar consultas automáticas/u)
})

test('source automation policy matching is exact and limited to reviewed endpoints', () => {
  assert.equal(VERIFIED_SOURCE_POLICIES.length, 71)
  const rssPolicy = VERIFIED_SOURCE_POLICIES.find((entry) => entry.kind === 'rss')
  const jsonPolicies = VERIFIED_SOURCE_POLICIES.filter((entry) => entry.kind === 'json')
  const jsonPolicy = jsonPolicies.find((entry) => entry.id === 'lever-despegar-argentina-json-2026-10-08')
  assert.ok(rssPolicy)
  assert.ok(jsonPolicy)
  assert.equal(jsonPolicies.length, 70)
  assert.equal(findVerifiedSourcePolicy('rss', rssPolicy.url)?.id, rssPolicy.id)
  assert.equal(findVerifiedSourcePolicy('rss', `${rssPolicy.url}#fragment`)?.id, rssPolicy.id)
  assert.equal(findVerifiedSourcePolicy('rss', `${rssPolicy.url}?page=2`), null)
  assert.equal(findVerifiedSourcePolicy('json', jsonPolicy.url)?.id, jsonPolicy.id)
  assert.equal(findVerifiedSourcePolicy('json', `${jsonPolicy.url}&skip=100`), null)
  assert.equal(findVerifiedSourcePolicy('website', jsonPolicy.url), null)
  const despegarConfig = validateJsonSourceConfig({
    itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', filterPath: '/country', filterValue: 'AR',
  })
  const leverPolicies = jsonPolicies.filter((policy) => policy.id.startsWith('lever-'))
  const smartRecruitersPolicies = jsonPolicies.filter((policy) => policy.connector === 'smartrecruiters-posting-details')
  const louisDreyfusPolicy = smartRecruitersPolicies.find((policy) => policy.smartRecruitersCompany === SMARTRECRUITERS_LDC_COMPANY)
  const cofacePolicy = smartRecruitersPolicies.find((policy) => policy.smartRecruitersCompany === SMARTRECRUITERS_COFACE_COMPANY)
  const psiCroPolicy = smartRecruitersPolicies.find((policy) => policy.smartRecruitersCompany === SMARTRECRUITERS_PSI_CRO_COMPANY)
  const miratechPolicy = smartRecruitersPolicies.find((policy) => policy.smartRecruitersCompany === SMARTRECRUITERS_MIRATECH_COMPANY)
  const cieloPolicy = smartRecruitersPolicies.find((policy) => policy.smartRecruitersCompany === SMARTRECRUITERS_CIELO_COMPANY)
  const greenhousePolicies = jsonPolicies.filter((policy) => policy.connector === 'greenhouse-public-jobs')
  const ashbyPolicies = jsonPolicies.filter((policy) => policy.connector === 'ashby-public-jobs')
  const workablePolicy = jsonPolicies.find((policy) => policy.connector === 'workable-sur-public-jobs')
  assert.equal(leverPolicies.length, 19)
  assert.ok(leverPolicies.every((policy) => policy.connector === 'lever-public-jobs'))
  const binancePolicy = leverPolicies.find((policy) => policy.id === 'lever-binance-argentina-json-2026-10-08')
  assert.ok(binancePolicy)
  assert.equal(binancePolicy.url, 'https://api.lever.co/v0/postings/binance?mode=json&limit=100')
  const yunoPolicy = leverPolicies.find((policy) => policy.id === 'lever-yuno-argentina-json-2026-10-08')
  assert.ok(yunoPolicy)
  assert.equal(yunoPolicy.url, 'https://api.lever.co/v0/postings/yuno?mode=json&limit=100')
  const listoPolicy = leverPolicies.find((policy) => policy.id === 'lever-listo-argentina-json-2026-10-08')
  assert.ok(listoPolicy)
  assert.equal(listoPolicy.url, 'https://api.lever.co/v0/postings/listo?mode=json&limit=100')
  const muttdataPolicy = leverPolicies.find((policy) => policy.id === 'lever-muttdata-argentina-json-2026-10-08')
  assert.ok(muttdataPolicy)
  assert.equal(muttdataPolicy.url, 'https://api.lever.co/v0/postings/muttdata?mode=json&limit=100')
  const truemlPolicy = leverPolicies.find((policy) => policy.id === 'lever-trueml-argentina-json-2026-10-09')
  assert.ok(truemlPolicy)
  assert.equal(truemlPolicy.url, 'https://api.lever.co/v0/postings/trueml?mode=json&limit=100')
  assert.equal(truemlPolicy.sourceName, 'TrueML · empleos en Argentina')
  assert.equal(truemlPolicy.reviewedOn, '2026-10-09')
  const doolaPolicy = leverPolicies.find((policy) => policy.id === 'lever-doola-argentina-json-2026-10-09')
  assert.ok(doolaPolicy)
  assert.equal(doolaPolicy.url, 'https://api.lever.co/v0/postings/doola?mode=json&limit=100')
  assert.deepEqual(doolaPolicy.leverArgentinaLocationLabels, ['Remote in Argentina'])
  assert.equal(doolaPolicy.reviewedOn, '2026-10-09')
  const saucePolicy = leverPolicies.find((policy) => policy.id === 'lever-sauce-argentina-json-2026-10-09')
  assert.ok(saucePolicy)
  assert.equal(saucePolicy.url, 'https://api.lever.co/v0/postings/Sauce?mode=json&limit=100')
  assert.equal(saucePolicy.sourceName, 'Sauce · empleos con ubicación en Argentina')
  assert.deepEqual(saucePolicy.leverArgentinaLocationLabels, ['Argentina'])
  assert.equal(saucePolicy.reviewedOn, '2026-10-09')
  const appenPolicy = leverPolicies.find((policy) => policy.id === 'lever-appen-argentina-json-2026-10-09')
  assert.ok(appenPolicy)
  assert.equal(appenPolicy.url, 'https://api.lever.co/v0/postings/appen-2?mode=json&limit=100')
  assert.equal(appenPolicy.sourceName, 'Appen · empleos con ubicación en Argentina')
  assert.deepEqual(appenPolicy.leverArgentinaLocationLabels, ['Remote - Argentina'])
  assert.equal(appenPolicy.reviewedOn, '2026-10-09')
  const anchoragePolicy = leverPolicies.find((policy) => policy.id === 'lever-anchorage-argentina-json-2026-10-09')
  const jeevesPolicy = leverPolicies.find((policy) => policy.id === 'lever-tryjeeves-argentina-json-2026-10-09')
  assert.ok(anchoragePolicy)
  assert.equal(anchoragePolicy.url, 'https://api.lever.co/v0/postings/anchorage?mode=json&limit=100')
  assert.equal(anchoragePolicy.sourceName, 'Anchorage Digital · empleos con ubicación en Argentina')
  assert.ok(jeevesPolicy)
  assert.equal(jeevesPolicy.url, 'https://api.lever.co/v0/postings/tryjeeves?mode=json&limit=100')
  assert.equal(jeevesPolicy.evidenceUrl, 'https://www.tryjeeves.com/careers')
  assert.equal(jeevesPolicy.sourceName, 'Jeeves · empleos en Argentina')
  assert.equal(jeevesPolicy.reviewedOn, '2026-10-09')
  assert.deepEqual(anchoragePolicy.leverArgentinaLocationLabels, ['Argentina'])
  assert.equal(anchoragePolicy.reviewedOn, '2026-10-09')
  const bluelightPolicy = leverPolicies.find((policy) => policy.id === 'lever-bluelightconsulting-argentina-json-2026-10-08')
  assert.equal(bluelightPolicy?.leverArgentinaMaxPostings, 200)
  assert.ok(leverPolicies.every((policy) => policy.id === bluelightPolicy?.id
    ? policy.leverArgentinaMaxPostings === 200
    : policy.leverArgentinaMaxPostings === undefined))
  assert.equal(greenhousePolicies.length, 27)
  assert.deepEqual(greenhousePolicies.map((policy) => policy.greenhouseBoardToken).slice(-5), ['jampp', 'fluxon', 'arizeai', 'cookunity', 'dept'])
  for (const [token, company] of [['backblaze', 'Backblaze'], ['sezzle', 'Sezzle'], ['appdirect', 'AppDirect'], ['able', 'Able'], ['newsela', 'Newsela'], ['precisionmedicinegroup', 'Precision Medicine Group'], ['greenhouse', 'Greenhouse'], ['coinbase', 'Coinbase'], ['counterpart', 'Counterpart'], ['interviewengineering', 'Karat (Interview Engineering)'], ['nimblegravity', 'Nimble Gravity'], ['jampp', 'Jampp'], ['fluxon', 'Fluxon'], ['arizeai', 'Arize AI'], ['cookunity', 'CookUnity'], ['dept', 'DEPT®']]) {
    const policy = greenhousePolicies.find((entry) => entry.greenhouseBoardToken === token)
    assert.ok(policy)
    assert.equal(policy.url, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`)
    assert.equal(policy.greenhouseCompanyName, company)
  }
  assert.equal(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'jampp')?.reviewedOn, '2026-10-09')
  assert.equal(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'fluxon')?.reviewedOn, '2026-10-09')
  assert.equal(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'arizeai')?.reviewedOn, '2026-10-09')
  assert.deepEqual(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'coinbase')?.greenhouseCustomCareerUrlPatterns, [
    { hostname: 'www.coinbase.com', pathname: '/careers/positions/{jobId}', jobIdQueryParam: 'gh_jid' },
  ])
  assert.equal(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'cookunity')?.reviewedOn, '2026-10-09')
  assert.deepEqual(greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'cookunity')?.greenhouseCustomCareerUrlPatterns, [
    { hostname: 'careers.cookunity.com', pathname: '/open-roles', jobIdQueryParam: 'gh_jid' },
  ])
  const deptPolicy = greenhousePolicies.find((policy) => policy.greenhouseBoardToken === 'dept')
  assert.equal(deptPolicy?.reviewedOn, '2026-10-09')
  assert.equal(deptPolicy?.evidenceUrl, 'https://www.dept.global/latam/trabajar-en-dept/empleos/')
  const ablePolicy = greenhousePolicies.find((entry) => entry.greenhouseBoardToken === 'able')
  assert.deepEqual(ablePolicy?.greenhouseArgentinaRegionalLocationLabels, ['LATAM', 'Latin America'])
  const nimbleGravityPolicy = greenhousePolicies.find((entry) => entry.greenhouseBoardToken === 'nimblegravity')
  assert.deepEqual(nimbleGravityPolicy?.greenhouseArgentinaRegionalLocationLabels, ['LATAM', 'Latin America'])
  assert.equal(ashbyPolicies.length, 18)
  assert.ok(workablePolicy)
  assert.equal(workablePolicy.url, WORKABLE_SUR_URL)
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(workablePolicy, workableArgentinaJsonConfig))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(workablePolicy, { ...workableArgentinaJsonConfig, filterValue: 'Mexico' }))
  assert.deepEqual(ashbyPolicies.map((policy) => policy.ashbyBoardToken), ['rehire', 'hirehangar', 'arq', 'profound', 'silver', 'anyone-ai', 'the-global-talent-co', 'mural', 'omniscient', 'optery', 'superhuman%20platform%20inc', 'go-nimbly', 'luxor', 'cas', 'bullpen-talent', 'latamcent', 'Abode%20Money', 'siena'])
  const sienaPolicy = ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'siena')
  assert.ok(sienaPolicy)
  assert.equal(sienaPolicy.id, 'ashby-siena-argentina-json-2026-10-09')
  assert.equal(sienaPolicy.url, 'https://api.ashbyhq.com/posting-api/job-board/siena')
  assert.equal(sienaPolicy.evidenceUrl, 'https://www.siena.cx/careers')
  assert.equal(sienaPolicy.ashbyCompanyName, 'Siena AI')
  assert.equal(sienaPolicy.reviewedOn, '2026-10-09')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'omniscient')?.ashbyCompanyName, 'Omniscient Digital')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'optery')?.ashbyCompanyName, 'Optery')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'superhuman%20platform%20inc')?.ashbyCompanyName, 'Superhuman')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'go-nimbly')?.ashbyCompanyName, 'Go Nimbly')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'luxor')?.ashbyCompanyName, 'Luxor Technology')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'cas')?.ashbyCompanyName, 'Cloud Accountant Staffing')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'cas')?.reviewedOn, '2026-10-09')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'bullpen-talent')?.ashbyCompanyName, 'Bullpen Talent (reclutador; empleador final por confirmar)')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'bullpen-talent')?.reviewedOn, '2026-10-09')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'latamcent')?.ashbyCompanyName, 'LatamCent (intermediario; empleador final por confirmar)')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'latamcent')?.reviewedOn, '2026-10-09')
  const abodeMoneyPolicy = ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'Abode%20Money')
  assert.equal(abodeMoneyPolicy?.url, 'https://api.ashbyhq.com/posting-api/job-board/Abode%20Money')
  assert.equal(abodeMoneyPolicy?.ashbyCompanyName, 'Abode Money')
  assert.equal(abodeMoneyPolicy?.reviewedOn, '2026-10-09')
  assert.equal(findVerifiedSourcePolicy('json', 'https://api.ashbyhq.com/posting-api/job-board/Abode%20Money')?.id, abodeMoneyPolicy?.id)
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'anyone-ai')?.ashbyCompanyName, 'Anyone AI (bolsa de empleo)')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'the-global-talent-co')?.ashbyCompanyName, 'The Global Talent Co. (empleador final por confirmar)')
  assert.equal(ashbyPolicies.find((policy) => policy.ashbyBoardToken === 'mural')?.ashbyCompanyName, 'Mural')
  assert.equal(smartRecruitersPolicies.length, 5)
  assert.equal(louisDreyfusPolicy?.url, SMARTRECRUITERS_LDC_URL)
  assert.equal(cofacePolicy?.url, SMARTRECRUITERS_COFACE_URL)
  assert.equal(cofacePolicy?.id, 'smartrecruiters-coface-argentina-json-2026-10-09')
  assert.equal(psiCroPolicy?.url, SMARTRECRUITERS_PSI_CRO_URL)
  assert.equal(psiCroPolicy?.id, 'smartrecruiters-psi-cro-argentina-json-2026-10-09')
  assert.equal(psiCroPolicy?.reviewedOn, '2026-10-09')
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(psiCroPolicy, smartRecruitersArgentinaJsonConfig))
  assert.equal(miratechPolicy?.url, SMARTRECRUITERS_MIRATECH_URL)
  assert.equal(miratechPolicy?.id, 'smartrecruiters-miratech-argentina-json-2026-10-09')
  assert.equal(miratechPolicy?.reviewedOn, '2026-10-09')
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(miratechPolicy, smartRecruitersArgentinaJsonConfig))
  assert.equal(cieloPolicy?.url, SMARTRECRUITERS_CIELO_URL)
  assert.equal(cieloPolicy?.id, 'smartrecruiters-cielo-argentina-json-2026-10-09')
  assert.equal(cieloPolicy?.reviewedOn, '2026-10-09')
  assert.equal(cieloPolicy?.evidenceUrl, 'https://careers.cielotalent.com/en/jobs')
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(cieloPolicy, smartRecruitersArgentinaJsonConfig))
  assert.ok(leverPolicies.filter((policy) => ![doolaPolicy.id, saucePolicy.id, appenPolicy.id, anchoragePolicy.id].includes(policy.id)).every((policy) => verifiedSourcePolicyMatchesJsonConfig(policy, despegarConfig)))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(doolaPolicy, { ...despegarConfig, filterPath: '', filterValue: '' }))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(doolaPolicy, despegarConfig))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(appenPolicy, { ...despegarConfig, filterPath: '', filterValue: '' }))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(appenPolicy, despegarConfig))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(saucePolicy, { ...despegarConfig, filterPath: '', filterValue: '' }))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(saucePolicy, despegarConfig))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(anchoragePolicy, { ...despegarConfig, filterPath: '', filterValue: '' }))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(anchoragePolicy, despegarConfig))
  assert.ok(leverPolicies.every((policy) => !verifiedSourcePolicyMatchesJsonConfig(policy, { ...despegarConfig, filterValue: 'US' })))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(louisDreyfusPolicy, smartRecruitersArgentinaJsonConfig))
  assert.ok(verifiedSourcePolicyMatchesJsonConfig(cofacePolicy, smartRecruitersArgentinaJsonConfig))
  assert.ok(!verifiedSourcePolicyMatchesJsonConfig(cofacePolicy, { ...smartRecruitersArgentinaJsonConfig, filterValue: 'us' }))
  assert.equal(requireVerifiedSourcePolicy('rss', rssPolicy.url).id, rssPolicy.id)
  assert.throws(() => requireVerifiedSourcePolicy('rss', 'https://example.com/feed'), /endpoints exactos/u)
})

test('recommended source cards use the exact verified policy groups they add', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const leverPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.kind === 'json' && policy.id.startsWith('lever-') && policy.id !== 'lever-despegar-argentina-json-2026-10-08')
  const smartRecruitersPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'smartrecruiters-posting-details')
  const greenhousePolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'greenhouse-public-jobs')
  const ashbyPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'ashby-public-jobs')

  assert.equal(leverPolicies.length, 18)
  assert.equal(smartRecruitersPolicies.length, 5)
  assert.equal(greenhousePolicies.length, 27)
  assert.equal(ashbyPolicies.length, 18)
  assert.match(appSource, /Agroindustria, finanzas, salud, talento y tecnología · \{smartRecruitersArgentinaPolicies\.length\} tableros SmartRecruiters/u)
  assert.match(appSource, /Ver empleos de Miratech/u)
  assert.match(appSource, /Ver empleos de Cielo/u)
  assert.match(appSource, /Agregar \$\{smartRecruitersArgentinaPolicies\.length\} tableros/u)
  assert.match(appSource, /Más vacantes argentinas · \{additionalLeverArgentinaPolicies\.length\} tableros Lever adicionales/u)
  assert.match(appSource, /Más rubros en Argentina · \{greenhouseArgentinaPolicies\.length\} tableros Greenhouse/u)
  assert.match(appSource, /Más sectores · \{ashbyArgentinaPolicies\.length\} tableros públicos de Ashby/u)
  assert.match(appSource, /TrueML, doola, Sauce, Appen, Anchorage Digital y Jeeves/u)
  assert.match(appSource, /LatamCent, Abode Money y Siena AI/u)
  assert.doesNotMatch(appSource, /ocho tableros públicos de Ashby|21 tableros Greenhouse|doce empresas/u)
})

test('only reviewed JSON mappings can enable their public endpoints', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-lever-policy-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const policies = VERIFIED_SOURCE_POLICIES.filter((entry) => entry.kind === 'json')
  assert.equal(policies.length, 70)
  const config = validateJsonSourceConfig({
    itemsPath: '', titlePath: '/text', urlPath: '/hostedUrl', filterPath: '/country', filterValue: 'AR',
  })
  const sources = policies.map((policy) => database.addSource({
    name: policy.sourceName ?? policy.title, url: policy.url, kind: 'json', profileId: null, enabled: true,
    automationEvidenceUrl: policy.evidenceUrl,
    jsonConfig: policy.connector === 'smartrecruiters-posting-details'
      ? smartRecruitersArgentinaJsonConfig
      : policy.connector === 'greenhouse-public-jobs'
        ? greenhouseArgentinaJsonConfig
        : policy.connector === 'ashby-public-jobs' ? ashbyArgentinaJsonConfig
          : policy.connector === 'workable-sur-public-jobs' ? workableArgentinaJsonConfig
            : policy.leverArgentinaLocationLabels ? { ...config, filterPath: '', filterValue: '' } : config,
    csvConfig: null,
  }))
  assert.ok(sources.every((source) => source.automationApproved))
  assert.deepEqual(new Set(database.enabledSources().map((entry) => entry.id)), new Set(sources.map((entry) => entry.id)))
  const policy = policies.find((entry) => entry.id === 'lever-despegar-argentina-json-2026-10-08')
  assert.ok(policy)
  assert.throws(() => database.addSource({
    name: 'Despegar sin filtro', url: policy.url, kind: 'json', profileId: null, enabled: true,
    automationEvidenceUrl: policy.evidenceUrl, jsonConfig: { ...config, filterPath: '', filterValue: '' }, csvConfig: null,
  }), /filtros exactos definidos por la política/u)
  database.close()
})

test('Workable public postings are attributed, filtered, deduplicated, and kept within reviewed limits', () => {
  const payload = workableArgentinaPayload({
    name: 'Sur',
    jobs: [
      {
        title: 'Technical Support Specialist', shortcode: 'ABCD1234', country: 'Argentina', city: 'Buenos Aires', state: 'Buenos Aires',
        url: 'https://apply.workable.com/j/ABCD1234', description: '<p>Support customers</p>', published_on: '2026-10-08T12:00:00Z',
      },
      {
        title: 'Technical Support Specialist', shortcode: 'ABCD1234', country: 'Argentina', city: 'Córdoba', state: 'Córdoba',
        url: 'https://apply.workable.com/j/ABCD1234', description: '<p>Support customers</p>', published_on: '2026-10-08T12:00:00Z',
      },
      {
        title: 'Other role', shortcode: 'MEX1234', country: 'Mexico', city: 'Mexico City', state: 'CDMX',
        url: 'https://apply.workable.com/j/MEX1234', description: '<p>Not for Argentina</p>',
      },
    ],
  })
  const records = mapJsonFeed(payload, workableArgentinaJsonConfig)
  assert.equal(records.length, 1)
  assert.equal(records[0].title, 'Technical Support Specialist')
  assert.equal(records[0].url, 'https://apply.workable.com/j/ABCD1234')
  assert.equal(records[0].company, 'Sur · empleador final por confirmar')
  assert.match(records[0].location, /Buenos Aires/u)
  assert.match(records[0].location, /Córdoba/u)
  assert.throws(() => workableArgentinaPayload({ name: 'Other', jobs: [] }), /cuenta no reconocidos/u)
  assert.throws(() => workableArgentinaPayload({
    name: 'Sur', jobs: [{ title: 'Role', shortcode: 'BAD1234', country: 'Mexico', url: 'https://evil.example/j/BAD1234' }],
  }), /enlace inválido/u)

  const overPublicLimit = Array.from({ length: WORKABLE_MAX_PUBLIC_JOBS + 1 }, (_, index) => ({
    title: 'Role', shortcode: `M${index}`, country: 'Mexico', url: `https://apply.workable.com/j/M${index}`,
  }))
  assert.throws(() => workableArgentinaPayload({ name: 'Sur', jobs: overPublicLimit }), /admite hasta/u)

  const overArgentinaLimit = Array.from({ length: WORKABLE_MAX_ARGENTINA_JOBS + 1 }, (_, index) => ({
    title: 'Role', shortcode: `A${index}`, country: 'Argentina', url: `https://apply.workable.com/j/A${index}`,
  }))
  assert.throws(() => workableArgentinaPayload({ name: 'Sur', jobs: overArgentinaLimit }), /más de 100 avisos argentinos/u)
})

test('maps SmartRecruiters public job details to direct Argentina posting links', () => {
  const list = {
    totalFound: 2,
    content: [
      { id: '744000154184669', company: { identifier: 'LouisDreyfusCompany' }, location: { country: 'ar' } },
      { id: '744000154107639', company: { identifier: 'LouisDreyfusCompany' }, location: { country: 'ar' } },
    ],
  }
  assert.deepEqual(smartRecruitersPostingIds(list), ['744000154184669', '744000154107639'])
  const payload = smartRecruitersDetailsPayload(list, [
    {
      id: '744000154184669', name: 'Coordinador/a Eléctrico', active: true, releasedDate: '2026-10-07T19:46:31.512Z',
      company: { identifier: 'LouisDreyfusCompany', name: 'Louis Dreyfus Company' },
      location: { country: 'ar', city: 'Bahía Blanca', region: 'Buenos Aires', fullLocation: 'Bahía Blanca, Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/LouisDreyfusCompany/744000154184669-coordinador-a-electrico',
      jobAd: { sections: { jobDescription: { text: 'Coordina el mantenimiento eléctrico.' } } },
    },
    {
      id: '744000154107639', name: 'Aviso cerrado', active: false,
      company: { identifier: 'LouisDreyfusCompany', name: 'Louis Dreyfus Company' },
      location: { country: 'ar' }, postingUrl: 'https://jobs.smartrecruiters.com/LouisDreyfusCompany/744000154107639-aviso-cerrado',
    },
  ])
  assert.deepEqual(mapJsonFeed(payload, smartRecruitersArgentinaJsonConfig), [{
    title: 'Coordinador/a Eléctrico',
    url: 'https://jobs.smartrecruiters.com/LouisDreyfusCompany/744000154184669-coordinador-a-electrico',
    description: 'Coordina el mantenimiento eléctrico.',
    company: 'Louis Dreyfus Company',
    location: 'Bahía Blanca, Buenos Aires, Argentina',
    salary: '',
    publishedAt: '2026-10-07T19:46:31.512Z',
  }])
  assert.throws(() => smartRecruitersPostingIds({ ...list, totalFound: 101 }), /hasta 100/u)
  assert.throws(() => smartRecruitersPostingIds({ ...list, content: [list.content[0]] }), /lista parcial/u)
  assert.throws(() => smartRecruitersDetailsPayload(list, [{
    id: '744000154184669', active: true, name: 'Puesto',
    company: { identifier: 'LouisDreyfusCompany' }, location: { country: 'ar' },
    postingUrl: 'https://api.smartrecruiters.com/v1/companies/LouisDreyfusCompany/postings/744000154184669',
  }, {}]), /tablero público de Louis Dreyfus/u)
})

test('maps Coface SmartRecruiters postings only for Argentina and keeps each public posting link', () => {
  const list = {
    totalFound: 3,
    content: [
      { id: '744000154135975', company: { identifier: SMARTRECRUITERS_COFACE_COMPANY }, location: { country: 'ar' } },
      { id: '744000152190044', company: { identifier: SMARTRECRUITERS_COFACE_COMPANY }, location: { country: 'ar' } },
      { id: '744000152184789', company: { identifier: SMARTRECRUITERS_COFACE_COMPANY }, location: { country: 'ar' } },
    ],
  }
  const details = [
    {
      id: '744000154135975', name: 'Pasante Comercial', active: true, releasedDate: '2026-10-07T15:21:47.344Z',
      company: { identifier: 'Coface', name: 'Coface' },
      location: { country: 'ar', city: 'CABA', region: 'Buenos Aires', fullLocation: 'CABA, Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Coface/744000154135975-pasante-comercial',
      jobAd: { sections: { jobDescription: { text: 'Soporte del equipo comercial.' } } },
    },
    {
      id: '744000152190044', name: 'Risk Underwriting Analyst', active: true, releasedDate: '2026-09-28T14:10:24.114Z',
      company: { identifier: 'Coface', name: 'Coface' },
      location: { country: 'ar', city: 'CABA', region: 'Buenos Aires', fullLocation: 'Puerto Madero, CABA, Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Coface/744000152190044-risk-underwriting-analyst',
      jobAd: { sections: { jobDescription: { text: 'Análisis de riesgo.' } } },
    },
    {
      id: '744000152184789', name: 'Analista de Riesgo Crediticio', active: true, releasedDate: '2026-09-28T13:52:34.737Z',
      company: { identifier: 'Coface', name: 'Coface' },
      location: { country: 'ar', city: 'CABA', region: 'Buenos Aires', fullLocation: 'Puerto Madero, CABA, Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Coface/744000152184789-analista-de-riesgo-crediticio',
      jobAd: { sections: { jobDescription: { text: 'Análisis de riesgo crediticio.' } } },
    },
  ]
  const ids = list.content.map((posting) => posting.id)
  assert.deepEqual(smartRecruitersPostingIds(list, SMARTRECRUITERS_COFACE_COMPANY), ids)
  assert.deepEqual(mapJsonFeed(smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_COFACE_COMPANY), smartRecruitersArgentinaJsonConfig), [
    { title: 'Pasante Comercial', url: details[0].postingUrl, description: 'Soporte del equipo comercial.', company: 'Coface', location: 'CABA, Buenos Aires, Argentina', salary: '', publishedAt: details[0].releasedDate },
    { title: 'Risk Underwriting Analyst', url: details[1].postingUrl, description: 'Análisis de riesgo.', company: 'Coface', location: 'Puerto Madero, CABA, Buenos Aires, Argentina', salary: '', publishedAt: details[1].releasedDate },
    { title: 'Analista de Riesgo Crediticio', url: details[2].postingUrl, description: 'Análisis de riesgo crediticio.', company: 'Coface', location: 'Puerto Madero, CABA, Buenos Aires, Argentina', salary: '', publishedAt: details[2].releasedDate },
  ])
  assert.throws(() => smartRecruitersPostingIds(list, SMARTRECRUITERS_LDC_COMPANY), /no pertenece a Louis Dreyfus Company/u)
  assert.throws(() => smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_LDC_COMPANY), /no pertenece a Louis Dreyfus Company/u)
})
test('SmartRecruiters rejects a detail link that points to another posting', () => {
  const list = {
    totalFound: 1,
    content: [{ id: '744000152184789', company: { identifier: SMARTRECRUITERS_COFACE_COMPANY }, location: { country: 'ar' } }],
  }
  const detail = {
    id: '744000152184789', name: 'Analista de Riesgo Crediticio', active: true, releasedDate: '2026-09-28T13:52:34.737Z',
    company: { identifier: 'Coface', name: 'Coface' },
    location: { country: 'ar', city: 'CABA', region: 'Buenos Aires', fullLocation: 'Puerto Madero, CABA, Buenos Aires, Argentina' },
    postingUrl: 'https://jobs.smartrecruiters.com/Coface/744000152190044-risk-underwriting-analyst',
    jobAd: { sections: { jobDescription: { text: 'Análisis de riesgo crediticio.' } } },
  }
  assert.throws(() => smartRecruitersDetailsPayload(list, [detail], SMARTRECRUITERS_COFACE_COMPANY), /no pertenece al tablero público/u)
})

test('maps PSI CRO SmartRecruiters postings only for Argentina and keeps the public company board', () => {
  const list = {
    totalFound: 2,
    content: [
      { id: '744000152731400', company: { identifier: SMARTRECRUITERS_PSI_CRO_COMPANY }, location: { country: 'ar' } },
      { id: '744000151586960', company: { identifier: SMARTRECRUITERS_PSI_CRO_COMPANY }, location: { country: 'ar' } },
    ],
  }
  const details = [
    {
      id: '744000152731400', name: 'Clinical Trials Lead Site Coordinator', active: true, releasedDate: '2026-09-30T16:52:25.048Z',
      company: { identifier: 'PSICRO', name: 'PSI CRO' },
      location: { country: 'ar', city: 'Mendoza', region: 'Mendoza', fullLocation: 'Mendoza, Mendoza, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/PSICRO/744000152731400-clinical-trials-lead-site-coordinator',
      jobAd: { sections: { jobDescription: { text: 'Coordinate site activities for clinical trials.' } } },
    },
    {
      id: '744000151586960', name: 'Project Finance Manager (Clinical Trial Proposals)', active: true, releasedDate: '2026-09-24T10:59:28.963Z',
      company: { identifier: 'PSICRO', name: 'PSI CRO' },
      location: { country: 'ar', city: 'Buenos Aires', region: 'Buenos Aires', fullLocation: 'Buenos Aires, Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/PSICRO/744000151586960-project-finance-manager-clinical-trial-proposals-',
      jobAd: { sections: { jobDescription: { text: 'Manage clinical trial proposal finances.' } } },
    },
  ]
  const ids = list.content.map((posting) => posting.id)
  assert.deepEqual(smartRecruitersPostingIds(list, SMARTRECRUITERS_PSI_CRO_COMPANY), ids)
  assert.deepEqual(mapJsonFeed(smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_PSI_CRO_COMPANY), smartRecruitersArgentinaJsonConfig), [
    { title: 'Clinical Trials Lead Site Coordinator', url: details[0].postingUrl, description: 'Coordinate site activities for clinical trials.', company: 'PSI CRO', location: 'Mendoza, Mendoza, Argentina', salary: '', publishedAt: details[0].releasedDate },
    { title: 'Project Finance Manager (Clinical Trial Proposals)', url: details[1].postingUrl, description: 'Manage clinical trial proposal finances.', company: 'PSI CRO', location: 'Buenos Aires, Buenos Aires, Argentina', salary: '', publishedAt: details[1].releasedDate },
  ])
  assert.throws(() => smartRecruitersPostingIds(list, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
  assert.throws(() => smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
})

test('maps Miratech SmartRecruiters postings only for active Argentina jobs on its public board', () => {
  const list = {
    totalFound: 3,
    content: [
      { id: '744000153757910', company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY }, location: { country: 'ar' } },
      { id: '744000150170169', company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY }, location: { country: 'ar' } },
      { id: '744000145514909', company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY }, location: { country: 'ar' } },
    ],
  }
  const details = [
    {
      id: '744000153757910', name: 'Senior Genesys Cloud Engineer', active: true, releasedDate: '2026-10-08T10:00:00Z',
      company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY, name: 'Miratech' },
      location: { country: 'ar', city: 'Mendoza', region: 'Mendoza', fullLocation: 'Mendoza, Mendoza, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Miratech1/744000153757910-senior-genesys-cloud-engineer',
      jobAd: { sections: { jobDescription: { text: 'Support Genesys Cloud services.' } } },
    },
    {
      id: '744000150170169', name: 'Senior Genesys Cloud Engineer', active: false, releasedDate: '2026-10-01T10:00:00Z',
      company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY, name: 'Miratech' },
      location: { country: 'ar', city: 'Buenos Aires', region: 'Buenos Aires', fullLocation: 'Buenos Aires, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Miratech1/744000150170169-senior-genesys-cloud-engineer',
    },
    {
      id: '744000145514909', name: 'AWS Cloud Engineer - Platform Operations', active: true, releasedDate: '2026-08-25T13:20:41.552Z',
      company: { identifier: SMARTRECRUITERS_MIRATECH_COMPANY, name: 'Miratech' },
      location: { country: 'ar', city: 'Argentina', region: 'LATAM', fullLocation: 'Argentina, LATAM, Argentina' },
      postingUrl: 'https://jobs.smartrecruiters.com/Miratech1/744000145514909-aws-cloud-engineer-platform-operations',
    },
  ]
  assert.deepEqual(smartRecruitersPostingIds(list, SMARTRECRUITERS_MIRATECH_COMPANY), list.content.map((posting) => posting.id))
  assert.deepEqual(mapJsonFeed(smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_MIRATECH_COMPANY), smartRecruitersArgentinaJsonConfig), [
    { title: 'Senior Genesys Cloud Engineer', url: details[0].postingUrl, description: 'Support Genesys Cloud services.', company: 'Miratech', location: 'Mendoza, Mendoza, Argentina', salary: '', publishedAt: details[0].releasedDate },
    { title: 'AWS Cloud Engineer - Platform Operations', url: details[2].postingUrl, description: '', company: 'Miratech', location: 'Argentina, LATAM', salary: '', publishedAt: details[2].releasedDate },
  ])
  assert.throws(() => smartRecruitersPostingIds(list, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
  assert.throws(() => smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
})

test('maps Cielo SmartRecruiters postings for Argentina with Cielo attribution and direct job links', () => {
  const list = {
    totalFound: 4,
    content: [
      { id: '744000153820909', company: { identifier: SMARTRECRUITERS_CIELO_COMPANY }, location: { country: 'ar' } },
      { id: '744000153602497', company: { identifier: SMARTRECRUITERS_CIELO_COMPANY }, location: { country: 'ar' } },
      { id: '744000149386769', company: { identifier: SMARTRECRUITERS_CIELO_COMPANY }, location: { country: 'ar' } },
      { id: '744000149095344', company: { identifier: SMARTRECRUITERS_CIELO_COMPANY }, location: { country: 'ar' } },
    ],
  }
  const titles = [
    'Specialized Talent Sourcer',
    'Senior Pharma Recruiter',
    'Specialized Talent Administrator & Coordinator',
    'Senior Talent Consultant',
  ]
  const details = list.content.map((posting, index) => ({
    id: posting.id,
    name: titles[index],
    active: true,
    releasedDate: `2026-10-0${6 - index}T12:00:00.000Z`,
    company: { identifier: SMARTRECRUITERS_CIELO_COMPANY, name: 'Cielo' },
    location: { country: 'ar', city: 'Buenos Aires', region: 'Buenos Aires', fullLocation: 'Buenos Aires, Buenos Aires, Argentina' },
    postingUrl: `https://jobs.smartrecruiters.com/Cielo2/${posting.id}`,
  }))
  assert.deepEqual(smartRecruitersPostingIds(list, SMARTRECRUITERS_CIELO_COMPANY), list.content.map((posting) => posting.id))
  assert.deepEqual(mapJsonFeed(smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_CIELO_COMPANY), smartRecruitersArgentinaJsonConfig), titles.map((title, index) => ({
    title,
    url: details[index].postingUrl,
    description: '',
    company: 'Cielo',
    location: 'Buenos Aires, Buenos Aires, Argentina',
    salary: '',
    publishedAt: details[index].releasedDate,
  })))
  assert.throws(() => smartRecruitersPostingIds(list, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
  assert.throws(() => smartRecruitersDetailsPayload(list, details, SMARTRECRUITERS_COFACE_COMPANY), /no pertenece a Coface/u)
})

test('maps Greenhouse public postings only for Argentina and preserves approved original links', () => {
  const payload = greenhouseArgentinaPayload({
    meta: { total: 3 },
    jobs: [
      {
        id: 4901044002, title: 'Account Executive', updated_at: '2026-10-08T10:00:00Z',
        absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/4901044002',
        content: '<p>Ventas B2B.</p>', location: { name: 'Buenos Aires, Argentina' },
      },
      {
        id: 22, title: 'Software Engineer', updated_at: '2026-10-07T10:00:00Z',
        absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/22',
        content: 'Remote', location: { name: 'Remote - ARG' },
      },
      {
        id: 33, title: 'Account Executive', absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/33',
        location: { name: 'New York, United States' },
      },
    ],
  }, 'invgate', 'InvGate')
  assert.deepEqual(mapJsonFeed(payload, greenhouseArgentinaJsonConfig), [
    {
      title: 'Account Executive',
      url: 'https://job-boards.greenhouse.io/invgate/jobs/4901044002',
      description: '<p>Ventas B2B.</p>',
      company: 'InvGate',
      location: 'Buenos Aires, Argentina',
      salary: '',
      publishedAt: '2026-10-08T10:00:00Z',
    },
    {
      title: 'Software Engineer',
      url: 'https://job-boards.greenhouse.io/invgate/jobs/22',
      description: 'Remote',
      company: 'InvGate',
      location: 'Remote - ARG',
      salary: '',
      publishedAt: '2026-10-07T10:00:00Z',
    },
  ])
  const deptPayload = greenhouseArgentinaPayload({
    meta: { total: 2 },
    jobs: [
      {
        id: 8246179,
        title: 'Manager, Paid Social',
        absolute_url: 'https://job-boards.greenhouse.io/dept/jobs/8246179',
        location: { name: 'Capital Federal or Gran Buenos Aires, Argentina; Mar del Plata, Buenos Aires, Argentina' },
      },
      {
        id: 8174506,
        title: 'Technology Director, Martech',
        absolute_url: 'https://job-boards.greenhouse.io/dept/jobs/8174506',
        content: 'Argentina appears in a separate metadata field, not in the job location.',
        location: { name: 'United States' },
        offices: [{ location: 'Argentina' }],
      },
    ],
  }, 'dept', 'DEPT®')
  assert.deepEqual(mapJsonFeed(deptPayload, greenhouseArgentinaJsonConfig), [{
    title: 'Manager, Paid Social',
    url: 'https://job-boards.greenhouse.io/dept/jobs/8246179',
    description: '',
    company: 'DEPT®',
    location: 'Capital Federal or Gran Buenos Aires, Argentina; Mar del Plata, Buenos Aires, Argentina',
    salary: '',
    publishedAt: '',
  }])
  const webflowPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 7293969,
      title: 'Senior Software Engineer, Fullstack',
      absolute_url: 'https://job-boards.greenhouse.io/webflow/jobs/7293969',
      location: { name: 'Argentina Remote' },
    }],
  }, 'webflow', 'Webflow')
  assert.deepEqual(mapJsonFeed(webflowPayload, greenhouseArgentinaJsonConfig), [{
    title: 'Senior Software Engineer, Fullstack',
    url: 'https://job-boards.greenhouse.io/webflow/jobs/7293969',
    description: '',
    company: 'Webflow',
    location: 'Argentina Remote',
    salary: '',
    publishedAt: '',
  }])
  const fluxonPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 4734095005,
      title: 'Staff Software Engineer',
      updated_at: '2026-09-18T05:16:28-04:00',
      absolute_url: 'https://job-boards.greenhouse.io/fluxon/jobs/4734095005',
      content: 'Fully remote, with candidates based in Buenos Aires, Argentina.',
      location: { name: 'Buenos Aires, Argentina, Remote' },
    }],
  }, 'fluxon', 'Fluxon')
  assert.deepEqual(mapJsonFeed(fluxonPayload, greenhouseArgentinaJsonConfig), [{
    title: 'Staff Software Engineer',
    url: 'https://job-boards.greenhouse.io/fluxon/jobs/4734095005',
    description: 'Fully remote, with candidates based in Buenos Aires, Argentina.',
    company: 'Fluxon',
    location: 'Buenos Aires, Argentina, Remote',
    salary: '',
    publishedAt: '2026-09-18T05:16:28-04:00',
  }])
  const arizePayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 6203648004,
      title: 'DevOps Support Engineer (Argentina)',
      updated_at: '2026-09-23T16:45:19-04:00',
      absolute_url: 'https://job-boards.greenhouse.io/arizeai/jobs/6203648004',
      content: 'Candidates based in Buenos Aires, Argentina.',
      location: { name: 'Remote (Buenos Aires)' },
    }],
  }, 'arizeai', 'Arize AI')
  assert.deepEqual(mapJsonFeed(arizePayload, greenhouseArgentinaJsonConfig), [{
    title: 'DevOps Support Engineer (Argentina)',
    url: 'https://job-boards.greenhouse.io/arizeai/jobs/6203648004',
    description: 'Candidates based in Buenos Aires, Argentina.',
    company: 'Arize AI',
    location: 'Remote (Buenos Aires)',
    salary: '',
    publishedAt: '2026-09-23T16:45:19-04:00',
  }])
  const powerDigitalPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 5117535007,
      title: 'B2B Marketing Associate Account Director',
      absolute_url: 'https://job-boards.greenhouse.io/powerdigitalmarketing/jobs/5117535007',
      location: { name: 'Remote - Argentina' },
    }],
  }, 'powerdigitalmarketing', 'Power Digital')
  assert.equal(mapJsonFeed(powerDigitalPayload, greenhouseArgentinaJsonConfig)[0]?.company, 'Power Digital')
  const brainlabsPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 4944369101,
      title: 'Data Analyst, Operations',
      updated_at: '2026-10-08T10:00:00Z',
      absolute_url: 'https://job-boards.eu.greenhouse.io/brainlabs/jobs/4944369101',
      content: '<p>Operations and data analysis.</p>',
      location: { name: 'Argentina' },
    }],
  }, 'brainlabs', 'Brainlabs')
  assert.deepEqual(mapJsonFeed(brainlabsPayload, greenhouseArgentinaJsonConfig), [{
    title: 'Data Analyst, Operations',
    url: 'https://job-boards.eu.greenhouse.io/brainlabs/jobs/4944369101',
    description: '<p>Operations and data analysis.</p>',
    company: 'Brainlabs',
    location: 'Argentina',
    salary: '',
    publishedAt: '2026-10-08T10:00:00Z',
  }])
  const coinbasePayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 8250934,
      title: 'Prime Operations Assistant',
      updated_at: '2026-10-08T10:00:00Z',
      absolute_url: 'https://www.coinbase.com/careers/positions/8250934?gh_jid=8250934',
      location: { name: 'Remote - Argentina' },
    }],
  }, 'coinbase', 'Coinbase', [], [{ hostname: 'www.coinbase.com', pathname: '/careers/positions/{jobId}', jobIdQueryParam: 'gh_jid' }])
  assert.deepEqual(mapJsonFeed(coinbasePayload, greenhouseArgentinaJsonConfig), [{
    title: 'Prime Operations Assistant',
    url: 'https://www.coinbase.com/careers/positions/8250934?gh_jid=8250934',
    description: '',
    company: 'Coinbase',
    location: 'Remote - Argentina',
    salary: '',
    publishedAt: '2026-10-08T10:00:00Z',
  }])
  for (const absoluteUrl of [
    'http://www.coinbase.com/careers/positions/8250934?gh_jid=8250934',
    'https://www.coinbase.com.evil.test/careers/positions/8250934?gh_jid=8250934',
    'https://www.coinbase.com/careers/positions/8250935?gh_jid=8250934',
    'https://www.coinbase.com/careers/positions/8250934?gh_jid=8250935',
    'https://www.coinbase.com/careers/positions/8250934?gh_jid=8250934&next=other',
    'https://www.coinbase.com/careers/positions/8250934?gh_jid=8250934&gh_jid=8250934',
  ]) {
    assert.throws(() => greenhouseArgentinaPayload({
      meta: { total: 1 },
      jobs: [{ id: 8250934, title: 'Prime Operations Assistant', absolute_url: absoluteUrl, location: { name: 'Remote - Argentina' } }],
    }, 'coinbase', 'Coinbase', [], [{ hostname: 'www.coinbase.com', pathname: '/careers/positions/{jobId}', jobIdQueryParam: 'gh_jid' }]), /enlace que no pertenece/u)
  }
  const cookUnityPattern = { hostname: 'careers.cookunity.com', pathname: '/open-roles', jobIdQueryParam: 'gh_jid' }
  const cookUnityPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{
      id: 8015034003,
      title: 'Recruiting Operations Specialist',
      updated_at: '2026-10-09T10:00:00Z',
      absolute_url: 'https://careers.cookunity.com/open-roles?gh_jid=8015034003',
      location: { name: 'Buenos Aires, Buenos Aires, Argentina' },
    }],
  }, 'cookunity', 'CookUnity', [], [cookUnityPattern])
  assert.deepEqual(mapJsonFeed(cookUnityPayload, greenhouseArgentinaJsonConfig), [{
    title: 'Recruiting Operations Specialist',
    url: 'https://careers.cookunity.com/open-roles?gh_jid=8015034003',
    description: '',
    company: 'CookUnity',
    location: 'Buenos Aires, Buenos Aires, Argentina',
    salary: '',
    publishedAt: '2026-10-09T10:00:00Z',
  }])
  for (const absoluteUrl of [
    'http://careers.cookunity.com/open-roles?gh_jid=8015034003',
    'https://careers.cookunity.com.evil.test/open-roles?gh_jid=8015034003',
    'https://careers.cookunity.com/jobs/8015034003?gh_jid=8015034003',
    'https://careers.cookunity.com/open-roles?gh_jid=8015034004',
    'https://careers.cookunity.com/open-roles?gh_jid=8015034003&next=other',
    'https://careers.cookunity.com/open-roles?gh_jid=8015034003&gh_jid=8015034003',
    'https://careers.cookunity.com:8443/open-roles?gh_jid=8015034003',
    'https://@careers.cookunity.com/open-roles?gh_jid=8015034003',
    'https://careers.cookunity.com/open-roles?gh_jid=8015034003#fragment',
  ]) {
    assert.throws(() => greenhouseArgentinaPayload({
      meta: { total: 1 },
      jobs: [{ id: 8015034003, title: 'Recruiting Operations Specialist', absolute_url: absoluteUrl, location: { name: 'Argentina' } }],
    }, 'cookunity', 'CookUnity', [], [cookUnityPattern]), /enlace que no pertenece/u)
  }
  const ableRegionalPayload = {
    meta: { total: 2 },
    jobs: [
      {
        id: 8785511002,
        title: 'Operations Analyst (Finance)',
        absolute_url: 'https://job-boards.greenhouse.io/able/jobs/8785511002',
        content: 'This position is 100% remote in Latin America.',
        location: { name: 'Remote, LatAm' },
      },
      {
        id: 8624699002,
        title: 'Principal Product Strategist, AI Engagement Leader',
        absolute_url: 'https://job-boards.greenhouse.io/able/jobs/8624699002',
        location: { name: 'Remote, USA' },
      },
    ],
  }
  assert.deepEqual(greenhouseArgentinaPayload(ableRegionalPayload, 'able', 'Able').jobs, [])
  const ablePayload = greenhouseArgentinaPayload(ableRegionalPayload, 'able', 'Able', ['LATAM', 'Latin America'])
  assert.deepEqual(mapJsonFeed(ablePayload, greenhouseArgentinaJsonConfig), [{
    title: 'Operations Analyst (Finance)',
    url: 'https://job-boards.greenhouse.io/able/jobs/8785511002',
    description: 'This position is 100% remote in Latin America.',
    company: 'Able',
    location: 'Remote, LatAm',
    salary: '',
    publishedAt: '',
  }])
  assert.throws(() => greenhouseArgentinaPayload({ meta: { total: 2 }, jobs: [] }, 'invgate', 'InvGate'), /lista parcial/u)
  assert.throws(() => greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{ id: 22, title: 'Puesto', absolute_url: 'https://example.com/invgate/jobs/22', location: { name: 'Argentina' } }],
  }, 'invgate', 'InvGate'), /enlace que no pertenece/u)
  assert.throws(() => greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [{ id: 22, title: 'Puesto', absolute_url: 'https://job-boards.eu.greenhouse.io/otro-tablero/jobs/22', location: { name: 'Argentina' } }],
  }, 'invgate', 'InvGate'), /enlace que no pertenece/u)
  const canonicalQueryPayload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [
      { id: 22, title: 'Puesto con query canónica', absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/22?gh_jid=22', location: { name: 'Argentina' } },
    ],
  }, 'invgate', 'InvGate')
  assert.deepEqual(canonicalQueryPayload.jobs.map((job) => job.title), ['Puesto con query canónica'])
  assert.throws(() => greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [
      { id: 23, title: 'Puesto con query ajena', absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/23?utm_source=x', location: { name: 'Argentina' } },
    ],
  }, 'invgate', 'InvGate'), /enlace que no pertenece/u)

  const tooManyArgentinaJobs = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    title: `Puesto ${index + 1}`,
    absolute_url: `https://job-boards.greenhouse.io/invgate/jobs/${index + 1}`,
    location: { name: 'Argentina' },
  }))
  assert.throws(() => greenhouseArgentinaPayload({ meta: { total: 101 }, jobs: tooManyArgentinaJobs }, 'invgate', 'InvGate'), /resultados parciales/u)
  assert.equal(GREENHOUSE_MAX_JOBS, 350)
  const tooManyListedJobs = Array.from({ length: GREENHOUSE_MAX_JOBS + 1 }, (_, index) => ({ id: index + 1 }))
  assert.throws(() => greenhouseArgentinaPayload({ meta: { total: tooManyListedJobs.length }, jobs: tooManyListedJobs }, 'invgate', 'InvGate'), /admite hasta 350/u)
})
test('Greenhouse rejects Córdoba Spain labels without Argentina', () => {
  const payload = greenhouseArgentinaPayload({
    meta: { total: 2 },
    jobs: [
      {
        id: 44, title: 'Puesto en Córdoba España',
        absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/44',
        content: '', location: { name: 'Córdoba, Spain' },
      },
      {
        id: 45, title: 'Puesto en Córdoba Argentina',
        absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/45',
        content: '', location: { name: 'Córdoba, Argentina' },
      },
    ],
  }, 'invgate', 'InvGate')
  assert.deepEqual(mapJsonFeed(payload, greenhouseArgentinaJsonConfig).map((item) => item.title), ['Puesto en Córdoba Argentina'])
})

test('Greenhouse keeps bare Córdoba as Argentine when no country disambiguates it', () => {
  const payload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [
      {
        id: 46, title: 'Puesto en Córdoba',
        absolute_url: 'https://job-boards.greenhouse.io/invgate/jobs/46',
        content: '', location: { name: 'Córdoba' },
      },
    ],
  }, 'invgate', 'InvGate')
  assert.deepEqual(mapJsonFeed(payload, greenhouseArgentinaJsonConfig).map((item) => item.title), ['Puesto en Córdoba'])
})
test('Greenhouse regional labels do not admit Spain locations', () => {
  const payload = greenhouseArgentinaPayload({
    meta: { total: 1 },
    jobs: [
      {
        id: 99, title: 'Puesto en Madrid LATAM',
        absolute_url: 'https://job-boards.greenhouse.io/able/jobs/99',
        content: '', location: { name: 'Madrid, Spain (LATAM)' },
      },
    ],
  }, 'able', 'Able', ['LATAM', 'Latin America'])
  assert.deepEqual(mapJsonFeed(payload, greenhouseArgentinaJsonConfig), [])
})

test('maps Ashby public jobs with explicit Argentina eligibility and preserves secondary locations', () => {
  const payload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [
      {
        title: 'Senior Editor',
        isListed: true,
        location: 'South Africa - Cape Town',
        address: { postalAddress: { addressCountry: 'South Africa', addressRegion: 'Western Cape', addressLocality: 'Cape Town' } },
        secondaryLocations: [
          { location: 'Argentina - Buenos Aires', address: { addressCountry: 'Argentina', addressRegion: 'Buenos Aires', addressLocality: 'Buenos Aires' } },
          { location: 'Chile - Santiago', address: { postalAddress: { addressCountry: 'Chile', addressLocality: 'Santiago' } } },
        ],
        descriptionPlain: 'Edición de contenido para clientes remotos.',
        publishedAt: '2026-10-08T12:00:00Z',
        jobUrl: 'https://jobs.ashbyhq.com/hirehangar/92e83288-5e3a-4de7-b379-3e5eb95650c6',
      },
      {
        title: 'Unlisted Argentina role', isListed: false, location: 'Argentina',
        jobUrl: 'https://example.com/hirehangar/not-public',
      },
      {
        title: 'US role', isListed: true, location: 'Remote',
        address: { postalAddress: { addressCountry: 'United States' } },
        jobUrl: 'https://jobs.ashbyhq.com/hirehangar/92e83288-5e3a-4de7-b379-3e5eb95650c8',
      },
    ],
  }, 'hirehangar', 'Hire Hangar')
  assert.deepEqual(mapJsonFeed(payload, ashbyArgentinaJsonConfig), [
    {
      title: 'Senior Editor',
      url: 'https://jobs.ashbyhq.com/hirehangar/92e83288-5e3a-4de7-b379-3e5eb95650c6',
      description: 'Edición de contenido para clientes remotos.',
      company: 'Hire Hangar',
      location: 'Buenos Aires, Argentina; Cape Town, Western Cape, South Africa; Santiago, Chile',
      salary: '',
      publishedAt: '2026-10-08T12:00:00Z',
    },
  ])
  const rehirePayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Inside Sales Representative',
      isListed: true,
      location: 'Rosario',
      address: { postalAddress: { addressCountry: 'Argentina', addressRegion: 'Santa Fe', addressLocality: 'Rosario' } },
      secondaryLocations: [],
      descriptionHtml: '<p>Atención al cliente.</p>',
      jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c7',
    }],
  }, 'rehire', 'Rehire')
  assert.equal(mapJsonFeed(rehirePayload, ashbyArgentinaJsonConfig)[0].location, 'Rosario, Santa Fe, Argentina')
  const arqPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Product Owner', isListed: true, location: 'London',
      secondaryLocations: [{ location: 'Buenos Aires', address: { postalAddress: { addressCountry: 'Argentina', addressRegion: 'Buenos Aires', addressLocality: 'Buenos Aires' } } }],
      jobUrl: 'https://jobs.ashbyhq.com/arq/92e83288-5e3a-4de7-b379-3e5eb95650c9',
    }],
  }, 'arq', 'ARQ')
  assert.equal(mapJsonFeed(arqPayload, ashbyArgentinaJsonConfig)[0].location, 'Buenos Aires, Argentina; London')
  const profoundPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Member of Technical Staff', isListed: true, location: 'New York',
      secondaryLocations: [{ location: 'Buenos Aires', address: { postalAddress: { addressCountry: 'Argentina', addressLocality: 'Buenos Aires' } } }],
      jobUrl: 'https://jobs.ashbyhq.com/profound/92e83288-5e3a-4de7-b379-3e5eb95650c0',
    }],
  }, 'profound', 'Profound')
  assert.equal(mapJsonFeed(profoundPayload, ashbyArgentinaJsonConfig)[0].location, 'Buenos Aires, Argentina; New York')
  const abodePayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Senior Customer Support Representative', isListed: true, location: 'Remote (Philippines)',
      address: { postalAddress: { addressCountry: 'Philippines', addressLocality: 'Cebu City' } },
      secondaryLocations: [{
        location: 'Remote (Argentina)',
        address: { postalAddress: { addressCountry: 'Argentina' } },
      }],
      jobUrl: 'https://jobs.ashbyhq.com/Abode%20Money/6451e363-87d6-41f7-9cb2-733e6d95e5f9',
    }],
  }, 'Abode%20Money', 'Abode Money')
  assert.deepEqual(mapJsonFeed(abodePayload, ashbyArgentinaJsonConfig).map((job) => ({
    title: job.title,
    url: job.url,
    company: job.company,
    location: job.location,
  })), [{
    title: 'Senior Customer Support Representative',
    url: 'https://jobs.ashbyhq.com/Abode%20Money/6451e363-87d6-41f7-9cb2-733e6d95e5f9',
    company: 'Abode Money',
    location: 'Argentina; Cebu City, Philippines',
  }])
  const sienaPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [
      {
        title: 'Software Engineer, Platform Experience', isListed: true, location: 'Argentina', workplaceType: 'Remote',
        secondaryLocations: [{ location: 'Buenos Aires', address: { postalAddress: { addressCountry: 'Argentina', addressLocality: 'Buenos Aires' } } }],
        jobUrl: 'https://jobs.ashbyhq.com/siena/9b020e8d-d953-4e52-b13e-f20397cc9199',
      },
      {
        title: 'Senior Fullstack Engineer', isListed: true, location: 'Argentina', workplaceType: 'Remote', secondaryLocations: [],
        jobUrl: 'https://jobs.ashbyhq.com/siena/91e5e63a-7b02-4176-8b8f-0747042d756f',
      },
      {
        title: 'Product Specialist', isListed: true, location: 'Remote - Europe', workplaceType: 'Remote',
        secondaryLocations: [{ location: 'Buenos Aires', address: { postalAddress: { addressCountry: 'Argentina', addressLocality: 'Buenos Aires' } } }],
        jobUrl: 'https://jobs.ashbyhq.com/siena/1216b030-76e0-443e-a7a7-7e826d3b3960',
      },
    ],
  }, 'siena', 'Siena AI')
  const sienaJobs = mapJsonFeed(sienaPayload, ashbyArgentinaJsonConfig)
  assert.deepEqual(sienaJobs.map((job) => job.title), ['Software Engineer, Platform Experience', 'Senior Fullstack Engineer', 'Product Specialist'])
  assert.ok(sienaJobs.every((job) => job.company === 'Siena AI'))
  assert.equal(sienaJobs[2].location, 'Buenos Aires, Argentina; Remote - Europe')
  const silverPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Backend Engineer', isListed: true, location: 'Argentina', secondaryLocations: [],
      jobUrl: 'https://jobs.ashbyhq.com/silver/92e83288-5e3a-4de7-b379-3e5eb95650c1',
    }],
  }, 'silver', 'Silver.dev (avisos de clientes)')
  assert.equal(mapJsonFeed(silverPayload, ashbyArgentinaJsonConfig)[0].company, 'Silver.dev (avisos de clientes)')
  const conflictingCountryPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [
      {
        title: 'Role mapped to Colombia', isListed: true, location: 'Argentina',
        address: { postalAddress: { addressCountry: 'Colombia' } }, secondaryLocations: [],
        jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c2',
      },
      {
        title: 'Role mapped to Spain', isListed: true, location: 'Córdoba',
        address: { postalAddress: { addressCountry: 'Spain' } }, secondaryLocations: [],
        jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c3',
      },
    ],
  }, 'rehire', 'Rehire')
  assert.deepEqual(mapJsonFeed(conflictingCountryPayload, ashbyArgentinaJsonConfig), [])
  const labelFallbackPayload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Location without country code', isListed: true, location: 'Buenos Aires', secondaryLocations: [],
      jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c4',
    }],
  }, 'rehire', 'Rehire')
  assert.equal(mapJsonFeed(labelFallbackPayload, ashbyArgentinaJsonConfig).length, 1)
  const tooManyAshbyJobs = Array.from({ length: 101 }, (_, index) => ({
    title: `Aviso ${index + 1}`,
    isListed: true,
    location: 'Buenos Aires, Argentina',
    jobUrl: `https://jobs.ashbyhq.com/arq/00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
  }))
  assert.throws(() => ashbyArgentinaPayload({ apiVersion: '1', jobs: tooManyAshbyJobs }, 'arq', 'ARQ'), /no se importaron resultados parciales/u)
  assert.throws(() => ashbyArgentinaPayload({ apiVersion: '1', jobs: [{ title: 'Aviso', location: 'Argentina' }] }, 'rehire', 'Rehire'), /habilitado para mostrarse públicamente/u)
  assert.throws(() => ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [{
      title: 'Puesto', isListed: true, location: 'Argentina',
      jobUrl: 'https://example.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c7',
    }],
  }, 'rehire', 'Rehire'), /enlace válido/u)
})

test('Ashby rejects Córdoba Spain labels without an Argentina country code', () => {
  const payload = ashbyArgentinaPayload({
    apiVersion: '1',
    jobs: [
      {
        title: 'Role in Córdoba Spain', isListed: true, location: 'Córdoba, Spain', secondaryLocations: [],
        jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c5',
      },
      {
        title: 'Role in Córdoba Argentina', isListed: true, location: 'Córdoba, Argentina', secondaryLocations: [],
        jobUrl: 'https://jobs.ashbyhq.com/rehire/92e83288-5e3a-4de7-b379-3e5eb95650c6',
      },
    ],
  }, 'rehire', 'Rehire')
  assert.deepEqual(mapJsonFeed(payload, ashbyArgentinaJsonConfig).map((item) => item.title), ['Role in Córdoba Argentina'])
})

test('maps configurable CSV columns, quoting, structured salary, and separators', () => {
  const config = {
    delimiter: ',',
    titleColumn: 'Título',
    urlColumn: 'Enlace',
    descriptionColumn: 'Descripción',
    companyColumn: 'Empresa',
    locationColumn: 'Localidad',
    salaryColumn: 'Sueldo',
    salaryMinimumColumn: 'Mínimo',
    salaryMaximumColumn: 'Máximo',
    salaryCurrencyColumn: 'Moneda',
    salaryPeriodColumn: 'Período',
    publishedAtColumn: 'Publicado',
  }
  const csv = '\uFEFFTítulo,Enlace,Descripción,Empresa,Localidad,Sueldo,Mínimo,Máximo,Moneda,Período,Publicado\r\n"Analista, junior",https://jobs.example/one,"Atender clientes,\nprocesar pedidos","ACME ""Argentina""",Rosario,,1200000,1500000,Pesos argentinos,mensal,2026-10-08\r\n'
  const records = mapCsvFeed(csv, config)
  assert.deepEqual(records, [{
    title: 'Analista, junior',
    url: 'https://jobs.example/one',
    description: 'Atender clientes,\nprocesar pedidos',
    company: 'ACME "Argentina"',
    location: 'Rosario',
    salary: '1200000 - 1500000 ARS monthly',
    publishedAt: '2026-10-08',
  }])
  assert.deepEqual(parseMonthlySalary(records[0].salary), { currency: 'ARS', lowerBound: 1_200_000, upperBound: 1_500_000, sourcePeriod: 'monthly' })

  const weeklyCsv = mapCsvFeed('Puesto,URL,Mínimo,Máximo,Moneda,Período\nAnalista,https://jobs.example/weekly,120000,,ARS,semanalmente\n', {
    ...config, titleColumn: 'Puesto', urlColumn: 'URL',
  })
  assert.equal(weeklyCsv[0].salary, '120000 ARS weekly')
  assert.deepEqual(parseMonthlySalary(weeklyCsv[0].salary), { currency: 'ARS', lowerBound: 520_000, upperBound: 520_000, sourcePeriod: 'weekly' })

  const dailyCsv = mapCsvFeed('Puesto,URL,Mínimo,Máximo,Moneda,Período\nAnalista,https://jobs.example/daily,40000,,ARS,diario\n', {
    ...config, titleColumn: 'Puesto', urlColumn: 'URL',
  })
  assert.deepEqual(parseMonthlySalary(dailyCsv[0].salary, { workDaysPerWeek: 5 }), {
    currency: 'ARS', lowerBound: 866_666.67, upperBound: 866_666.67, sourcePeriod: 'daily',
  })

  const semicolon = validateCsvSourceConfig({ ...config, delimiter: ';', titleColumn: 'Puesto', urlColumn: 'URL' })
  assert.equal(mapCsvFeed('Puesto;URL\nVendedora;https://jobs.example/two\n', semicolon)[0].title, 'Vendedora')
  assert.throws(() => validateCsvSourceConfig({ ...config, delimiter: '|' }), /separador/u)
  assert.throws(() => validateCsvSourceConfig({ ...config, salaryCurrencyColumn: '' }), /mínimo, moneda y período/u)
  assert.throws(() => mapCsvFeed('Puesto,URL\n"sin cerrar,https://jobs.example/three\n', config), /sin cerrar/u)
  assert.throws(() => mapCsvFeed('Puesto,Puesto,URL\nA,A,https://jobs.example/duplicate\n', config), /repite el encabezado/u)
})

test('decodes local CSV text as UTF-8, Windows-1252, or UTF-16LE when marked', () => {
  const csv = 'Puesto;Descripción\nAnalista;Atención al público'
  assert.deepEqual(decodeCsvBytes(Buffer.from(csv, 'utf8')), { contents: csv, encoding: 'UTF-8' })
  assert.deepEqual(decodeCsvBytes(Buffer.from(csv, 'latin1')), { contents: csv, encoding: 'Windows-1252' })
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')])
  assert.deepEqual(decodeCsvBytes(utf16le), { contents: csv, encoding: 'UTF-16LE' })
})

test('imports a local CSV into SQLite with profile ranking, canonical deduplication, and row counts', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-csv-import-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const profile = database.saveProfile({
    name: 'Analítica',
    searchDescription: '',
    roles: ['Analista'],
    locations: [],
    radiusKm: 0,
    includeKeywords: [],
    excludeKeywords: ['nocturno'],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: null,
    minimumSalaryCurrency: 'ARS',
    active: true,
  })
  const contents = [
    'Puesto;Enlace;Empresa;Localidad;Descripción;Sueldo;Publicado',
    'Analista de datos;https://jobs.example/uno?utm_source=portal#detalles;ACME;Rosario;Análisis de reportes;;2026-10-08',
    'Analista de datos;https://jobs.example/uno;ACME;Rosario;Análisis de reportes;;2026-10-08',
    ';https://jobs.example/sin-puesto;ACME;Rosario;Aviso incompleto;;',
    'Analista de datos;https://persona:clave@jobs.example/credencial;ACME;Rosario;Aviso con enlace no seguro;;',
    'Operario nocturno;https://jobs.example/nocturno;ACME;Rosario;Turno nocturno;;',
  ].join('\n')
  const config = {
    delimiter: ';',
    titleColumn: 'Puesto',
    urlColumn: 'Enlace',
    descriptionColumn: 'Descripción',
    companyColumn: 'Empresa',
    locationColumn: 'Localidad',
    salaryColumn: 'Sueldo',
    salaryMinimumColumn: '',
    salaryMaximumColumn: '',
    salaryCurrencyColumn: '',
    salaryPeriodColumn: '',
    publishedAtColumn: 'Publicado',
  }

  assert.equal(detectCsvDelimiter(contents), ';')
  assert.deepEqual(importLocalCsv({ contents, profileId: profile.id, sourceName: 'Portal de prueba', config }, database), {
    added: 1,
    duplicates: 1,
    skipped: 2,
    filtered: 1,
  })
  const [saved] = database.listOpportunities()
  assert.equal(saved.url, 'https://jobs.example/uno')
  assert.equal(saved.source, 'Portal de prueba')
  assert.equal(saved.profileId, profile.id)
  assert.equal(saved.matchScore, 40)
  assert.deepEqual(saved.matchReasons, ['Menciona el puesto: Analista'])
  assert.deepEqual(importLocalCsv({ contents, profileId: profile.id, sourceName: 'Portal de prueba', config }, database), {
    added: 0,
    duplicates: 2,
    skipped: 2,
    filtered: 1,
  })
  assert.throws(() => importLocalCsv({ contents, profileId: 'missing', sourceName: 'Prueba', config }, database), /perfil seleccionado/u)
  assert.throws(() => importLocalCsv({ contents: 'x'.repeat(5 * 1024 * 1024 + 1), profileId: null, sourceName: 'Prueba', config }, database), /5 MB/u)
  database.close()
})

test('imports a local JSON export using a saved assisted source mapping without querying its endpoint', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-json-import-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const profile = database.saveProfile({
    name: 'Analítica',
    searchDescription: '',
    roles: ['Analista'],
    locations: [],
    radiusKm: 0,
    includeKeywords: [],
    excludeKeywords: ['nocturno'],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: null,
    minimumSalaryCurrency: 'ARS',
    active: true,
  })
  const config = {
    itemsPath: '/data/jobs',
    titlePath: '/role',
    urlPath: '/link',
    descriptionPath: '/summary',
    companyPath: '/company',
    locationPath: '/location',
    salaryPath: '/salary',
    salaryMinimumPath: '',
    salaryMaximumPath: '',
    salaryCurrencyPath: '',
    salaryPeriodPath: '',
    publishedAtPath: '/published',
  }
  const source = database.addSource({
    name: 'Exportación del portal',
    url: 'https://jobs.example/api/jobs.json',
    kind: 'json',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: '',
    jsonConfig: config,
    csvConfig: null,
  })
  assert.equal(source.enabled, false)
  assert.equal(database.enabledSources().length, 0)
  const contents = JSON.stringify({ data: { jobs: [
    { role: 'Analista de datos', link: '/positions/one?utm_source=portal', summary: 'Análisis de reportes', company: 'ACME', location: 'Rosario', published: '2026-10-08' },
    { role: 'Analista de datos', link: 'https://jobs.example/positions/one', summary: 'Análisis de reportes', company: 'ACME', location: 'Rosario', published: '2026-10-08' },
    { role: '', link: '/positions/missing', summary: 'Fila incompleta' },
    { role: 'Operario nocturno', link: '/positions/nocturno', summary: 'Turno nocturno' },
    { role: 'Analista de datos', link: 'https://persona:clave@jobs.example/apply', summary: 'Enlace no seguro' },
  ] } })
  const input = { contents, sourceId: source.id, profileId: profile.id }
  assert.deepEqual(previewLocalJsonImport(input, database), {
    itemCount: 5,
    mappedCount: 4,
    skipped: 2,
    filtered: 1,
    samples: [
      { title: 'Analista de datos', company: 'ACME', url: 'https://jobs.example/positions/one' },
      { title: 'Analista de datos', company: 'ACME', url: 'https://jobs.example/positions/one' },
      { title: 'Operario nocturno', company: 'Empresa no informada', url: 'https://jobs.example/positions/nocturno' },
    ],
  })
  assert.equal(previewLocalJsonImport({ ...input, contents: `\uFEFF${contents}` }, database).itemCount, 5)
  assert.deepEqual(importLocalJson(input, database), { added: 1, duplicates: 1, skipped: 2, filtered: 1 })
  const [saved] = database.listOpportunities()
  assert.equal(saved.source, source.name)
  assert.equal(saved.url, 'https://jobs.example/positions/one')
  assert.equal(saved.profileId, profile.id)
  assert.deepEqual(importLocalJson(input, database), { added: 0, duplicates: 2, skipped: 2, filtered: 1 })
  assert.equal(database.listSources().find((item) => item.id === source.id).lastAttemptAt, null)
  assert.throws(() => previewLocalJsonImport({ ...input, contents: '{' }, database), /documento JSON válido/u)
  assert.throws(() => importLocalJson({ ...input, contents: 'x'.repeat(5 * 1024 * 1024 + 1) }, database), /5 MB/u)
  assert.throws(() => importLocalJson({ ...input, profileId: 'missing' }, database), /perfil seleccionado/u)
  database.close()
})

test('normalizes tracking links and rejects non-web schemes or embedded credentials', () => {
  assert.equal(
    normalizeOpportunityUrl('https://jobs.example/search?utm_campaign=mail&role=analyst#apply'),
    'https://jobs.example/search?role=analyst',
  )
  assert.throws(() => normalizeOpportunityUrl('javascript:alert(1)'), /HTTP o HTTPS/u)
  assert.throws(() => normalizeOpportunityUrl('https://user:secret@jobs.example/apply'), /HTTP o HTTPS/u)
  assert.equal(
    normalizeOpportunityUrl('  https://jobs.example/search?role=analyst  '),
    'https://jobs.example/search?role=analyst',
  )
})
test('strips advertising and analytics trackers from saved links', () => {
  assert.equal(
    normalizeOpportunityUrl('https://jobs.example/apply?msclkid=abc&role=analyst'),
    'https://jobs.example/apply?role=analyst',
  )
  assert.equal(
    normalizeOpportunityUrl('https://jobs.example/apply?_ga=1.2.3&role=analyst'),
    'https://jobs.example/apply?role=analyst',
  )
})

test('maps user-configured JSON sources, requires opt-in, and keeps private network targets blocked', async (context) => {
  const config = {
    itemsPath: '/data/jobs',
    titlePath: '/role/title',
    urlPath: '/links/apply',
    descriptionPath: '/summary',
    companyPath: '/employer/name',
    locationPath: '/place/name',
    salaryPath: '/salary/text',
    salaryMinimumPath: '',
    salaryMaximumPath: '',
    salaryCurrencyPath: '',
    salaryPeriodPath: '',
    publishedAtPath: '/created_at',
    filterPath: '',
    filterValue: '',
  }
  const records = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Administrativa contable' },
    links: { apply: 'https://jobs.example/one' },
    summary: 'Experiencia en cuentas a pagar.',
    employer: { name: 'Empresa de prueba' },
    place: { name: 'Rosario, Santa Fe' },
    salary: { text: 'ARS 1.200.000 mensuales' },
    created_at: '2026-10-08T12:00:00Z',
  }] } }, config)
  assert.deepEqual(records, [{
    title: 'Administrativa contable',
    url: 'https://jobs.example/one',
    description: 'Experiencia en cuentas a pagar.',
    company: 'Empresa de prueba',
    location: 'Rosario, Santa Fe',
    salary: 'ARS 1.200.000 mensuales',
    publishedAt: '2026-10-08T12:00:00Z',
  }])

  const structuredConfig = {
    ...config,
    salaryMinimumPath: '/salary/min',
    salaryMaximumPath: '/salary/max',
    salaryCurrencyPath: '/salary/currency',
    salaryPeriodPath: '/salary/period',
  }
  const structured = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Analista de soporte' },
    links: { apply: 'https://jobs.example/two' },
    salary: { text: 'sueldo de referencia', min: '1.200.000', max: 1_500_000, currency: 'euros', period: 'mensal' },
  }] } }, structuredConfig)[0]
  assert.equal(structured.salary, '1200000 - 1500000 EUR monthly')
  assert.deepEqual(parseMonthlySalary(structured.salary), { currency: 'EUR', lowerBound: 1_200_000, upperBound: 1_500_000, sourcePeriod: 'monthly' })
  const salaryProfile = {
    id: 'structured-salary', name: 'Soporte', searchDescription: '', roles: [], locations: [], radiusKm: 0,
    includeKeywords: [], excludeKeywords: [], workMode: 'indistinto', schedule: '', minimumSalary: 1_000_000,
    minimumSalaryCurrency: 'ARS', active: true, createdAt: '', updatedAt: '',
  }
  assert.ok(calculateFit(salaryProfile, structured.title, structured.description, structured.location, structured.salary))

  const annual = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Analista de soporte' }, links: { apply: 'https://jobs.example/annual' },
    salary: { min: 18_000_000, max: 24_000_000, currency: 'ARS', period: 'anual' },
  }] } }, structuredConfig)[0]
  assert.equal(annual.salary, '18000000 - 24000000 ARS annual')
  assert.deepEqual(parseMonthlySalary(annual.salary), { currency: 'ARS', lowerBound: 1_500_000, upperBound: 2_000_000, sourcePeriod: 'annual' })
  const annualFit = calculateFit(salaryProfile, annual.title, annual.description, annual.location, annual.salary)
  assert.ok(annualFit)
  assert.ok(annualFit.reasons.some((reason) => reason.includes('dividido por 12')))
  assert.ok(!annualFit.missing.some((reason) => reason.includes('no se aplicó el mínimo')))
  const annualCrossingRange = calculateFit({ ...salaryProfile, minimumSalary: 1_600_000 }, annual.title, annual.description, annual.location, annual.salary)
  assert.ok(annualCrossingRange)
  assert.ok(annualCrossingRange.missing.includes('El rango salarial incluye importes por debajo del mínimo de ARS; se conserva sin confirmar'))
  assert.equal(calculateFit({ ...salaryProfile, minimumSalary: 2_100_000 }, annual.title, annual.description, annual.location, annual.salary), null)
  const hourly = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Analista de soporte' }, links: { apply: 'https://jobs.example/hourly' },
    salary: { min: 30, max: 35, currency: 'USD', period: 'hourly' },
  }] } }, structuredConfig)[0]
  assert.equal(hourly.salary, '30 - 35 USD hourly')
  assert.deepEqual(parseMonthlySalary(hourly.salary, { workHoursPerWeek: 40 }), {
    currency: 'USD', lowerBound: 5_200, upperBound: 6_066.67, sourcePeriod: 'hourly',
  })
  const hourlyFit = calculateFit({ ...salaryProfile, minimumSalary: 5_000, minimumSalaryCurrency: 'USD', workHoursPerWeek: 40 }, hourly.title, hourly.description, hourly.location, hourly.salary)
  assert.ok(hourlyFit?.reasons.some((reason) => reason.includes('sueldo por hora publicado')))
  const weekly = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Analista de soporte' }, links: { apply: 'https://jobs.example/weekly-json' },
    salary: { min: 120_000, currency: 'ARS', period: 'por semana' },
  }] } }, structuredConfig)[0]
  assert.equal(weekly.salary, '120000 ARS weekly')
  assert.ok(calculateFit({ ...salaryProfile, minimumSalary: 500_000 }, weekly.title, weekly.description, weekly.location, weekly.salary)
    ?.reasons.some((reason) => reason.includes('sueldo semanal publicado')))
  const unknownPeriod = mapJsonFeed({ data: { jobs: [{
    role: { title: 'Analista de soporte' }, links: { apply: 'https://jobs.example/unknown-period' },
    salary: { min: 1_200_000, max: 1_500_000, currency: 'ARS', period: 'monthly 2026' },
  }] } }, structuredConfig)[0]
  assert.equal(unknownPeriod.salary, '1200000 - 1500000 ARS periodo informado sin normalizar')
  assert.equal(parseMonthlySalary(unknownPeriod.salary), null)
  assert.throws(() => validateJsonSourceConfig({ ...config, salaryCurrencyPath: '/salary/currency' }), /mínimo, moneda y período/)
  assert.throws(() => validateJsonSourceConfig({ ...structuredConfig, salaryMinimumPath: '/salary~2min' }), /escape inválido/)
  const legacyConfig = { ...config }
  delete legacyConfig.salaryMinimumPath
  delete legacyConfig.salaryMaximumPath
  delete legacyConfig.salaryCurrencyPath
  delete legacyConfig.salaryPeriodPath
  assert.deepEqual(validateJsonSourceConfig(legacyConfig), config)

  assert.throws(() => mapJsonFeed({ jobs: [] }, { ...config, itemsPath: '/jobs~2' }), /escape inválido/)
  assert.throws(() => mapJsonFeed({ data: { jobs: [{ role: { name: 'Sin ruta esperada' } }] } }, config), /revisá el mapeo JSON/)

  const despegarConfig = {
    ...config,
    itemsPath: '',
    titlePath: '/text',
    urlPath: '/hostedUrl',
    descriptionPath: '/descriptionPlain',
    locationPath: '/categories/location',
    publishedAtPath: '/createdAt',
    filterPath: '/country',
    filterValue: 'AR',
  }
  const postings = [
    { text: 'Ejecutivo de Cuentas', hostedUrl: 'https://jobs.lever.co/despegar/arg', country: 'AR', createdAt: 1712320432451, categories: { location: 'Córdoba' } },
    { text: 'Software Engineer', hostedUrl: 'https://jobs.lever.co/despegar/us', country: 'US', categories: { location: 'United States' } },
  ]
  assert.equal(jsonFeedItemCount(postings, despegarConfig), 2)
  assert.deepEqual(mapJsonFeed(postings, despegarConfig), [{
    title: 'Ejecutivo de Cuentas', url: 'https://jobs.lever.co/despegar/arg', description: '', company: '',
    location: 'Córdoba', salary: '', publishedAt: new Date(1712320432451).toISOString(),
  }])
  assert.throws(() => validateJsonSourceConfig({ ...despegarConfig, filterValue: '' }), /ruta como el valor esperado/u)

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-json-source-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  assert.throws(() => database.addSource({
    name: 'API con credencial',
    url: 'https://jobs.example/jobs?api_key=no-guardar',
    kind: 'json',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: 'https://example.com/terms',
    jsonConfig: config,
    csvConfig: null,
  }), /no incluir claves o credenciales/)
  const source = database.addSource({
    name: 'API de prueba',
    url: 'https://127.0.0.1/jobs.json',
    kind: 'json',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: 'https://example.com/terms',
    jsonConfig: structuredConfig,
    csvConfig: null,
  })
  assert.deepEqual(source.jsonConfig, structuredConfig)
  assert.equal(source.enabled, false)
  assert.equal(source.automationApproved, false)

  const customSource = database.addSource({
    name: 'API pública autorizada',
    url: 'https://jobs.example/authorized.json',
    kind: 'json',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: '',
    jsonConfig: structuredConfig,
    csvConfig: null,
  })
  assert.equal(customSource.enabled, true)
  assert.equal(customSource.customAutomationApproved, true)
  assert.equal(database.enabledSources().some((item) => item.id === customSource.id), true)

  const csvConfig = {
    delimiter: ';',
    titleColumn: 'Puesto',
    urlColumn: 'Enlace',
    descriptionColumn: '',
    companyColumn: '',
    locationColumn: '',
    salaryColumn: '',
    salaryMinimumColumn: '',
    salaryMaximumColumn: '',
    salaryCurrencyColumn: '',
    salaryPeriodColumn: '',
    publishedAtColumn: '',
  }
  const assistedCsv = database.addSource({
    name: 'CSV sin autorización',
    url: 'https://jobs.example/jobs.csv',
    kind: 'csv',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: '',
    jsonConfig: null,
    csvConfig,
  })
  assert.equal(assistedCsv.enabled, false)
  assert.equal(assistedCsv.automationApproved, false)
  assert.throws(() => database.addSource({
    name: 'CSV con credencial',
    url: 'https://jobs.example/jobs.csv?token=no-guardar',
    kind: 'csv',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: 'https://example.com/terms',
    jsonConfig: null,
    csvConfig,
  }), /no incluir claves o credenciales/u)
  const csvSource = database.addSource({
    name: 'CSV de prueba',
    url: 'https://127.0.0.1/jobs.csv',
    kind: 'csv',
    profileId: null,
    enabled: true,
    automationEvidenceUrl: 'https://example.com/terms',
    jsonConfig: null,
    csvConfig,
  })
  assert.deepEqual(csvSource.csvConfig, csvConfig)
  assert.equal(csvSource.enabled, false)
  const approvedCsvSource = database.addSource({
    name: 'CSV público autorizado',
    url: 'https://jobs.example/authorized.csv',
    kind: 'csv',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: '',
    jsonConfig: null,
    csvConfig,
  })
  assert.equal(approvedCsvSource.enabled, true)
  assert.equal(approvedCsvSource.customAutomationApproved, true)
  const result = await runSearch(database, { fetchSource: async () => [] })
  assert.equal(result.checkedSources, 2)
  assert.deepEqual(result.errors, [])
  assert.equal(database.enabledSources().length, 2)
  assert.equal(database.listSources().find((item) => item.id === source.id).lastAttemptAt, null)
  assert.equal(database.listSources().find((item) => item.id === csvSource.id).lastAttemptAt, null)
  await assert.rejects(testJsonFeed('https://127.0.0.1/jobs.json', config), /red local/)
  await assert.rejects(testCsvFeed('https://127.0.0.1/jobs.csv', csvConfig), /red local/)
  database.close()
})

test('runSearch exposes per-source truncation without counting it as a failure', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-truncation-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  database.addSource({
    name: 'Feed largo autorizado',
    url: 'https://example.org/long-jobs.xml',
    kind: 'rss',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: '',
  })
  const items = Array.from({ length: 105 }, (_, index) => ({ title: `Aviso ${index + 1}`, link: `https://example.org/job/${index + 1}` }))
  const result = await runSearch(database, { fetchSource: async () => items })
  assert.equal(result.checkedSources, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(result.truncated.length, 1)
  assert.match(result.truncated[0].message, /Se conservaron 100 de 105 avisos/u)
  database.close()
})

test('runSearch does not import results from a source paused while its request is in flight', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-paused-source-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const source = database.addSource({
    name: 'Feed pausado durante la consulta',
    url: 'https://example.org/paused-jobs.xml',
    kind: 'rss',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: '',
  })
  let resolveFetch
  const pendingFetch = new Promise((resolve) => { resolveFetch = resolve })
  const searchPromise = runSearch(database, { fetchSource: async () => pendingFetch })

  database.updateSourceEnabled(source.id, false)
  resolveFetch([{ title: 'Vacante después de pausar', link: 'https://example.org/job/paused' }])

  const result = await searchPromise
  assert.equal(result.checkedSources, 1)
  assert.equal(result.added, 0)
  assert.equal(database.listOpportunities().length, 0)
  assert.equal(database.listSources().find((item) => item.id === source.id).lastCheckedAt, null)
  database.close()
})

test('runSearch does not mark a paused source as failed after its pending request rejects', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-paused-source-error-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const source = database.addSource({
    name: 'Feed pausado durante el error',
    url: 'https://example.org/paused-error-jobs.xml',
    kind: 'rss',
    profileId: null,
    enabled: true,
    customAutomationApproved: true,
    automationEvidenceUrl: '',
  })
  let rejectFetch
  const pendingFetch = new Promise((_, reject) => { rejectFetch = reject })
  const searchPromise = runSearch(database, { fetchSource: async () => pendingFetch })

  database.updateSourceEnabled(source.id, false)
  rejectFetch(new Error('fallo después de pausar'))

  const result = await searchPromise
  assert.deepEqual(result.errors, [])
  const paused = database.listSources().find((item) => item.id === source.id)
  assert.equal(paused.lastError, null)
  assert.equal(paused.lastAttemptAt, null)
  database.close()
})

test('keeps multiple profiles and PDF copies locally without changing the selected originals', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-multiple-data-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const userData = path.join(directory, 'app-data')
  const originalOne = path.join(directory, 'cv-admin.pdf')
  const originalTwo = path.join(directory, 'cv-support.pdf')
  const bytesOne = Buffer.from('%PDF-1.7\nCV administrativo de prueba')
  const bytesTwo = Buffer.from('%PDF-1.7\nCV de soporte de prueba')
  fs.writeFileSync(originalOne, bytesOne)
  fs.writeFileSync(originalTwo, bytesTwo)

  const database = new RadarDatabase(userData)
  const profile = (name) => ({
    name,
    searchDescription: '',
    roles: [name],
    locations: ['Santa Fe'],
    radiusKm: 25,
    includeKeywords: [],
    excludeKeywords: [],
    workMode: 'indistinto',
    schedule: '',
    minimumSalary: null,
    minimumSalaryCurrency: name === 'Soporte técnico' ? 'USD' : 'ARS',
    active: true,
  })
  database.saveProfile(profile('Administración'))
  database.saveProfile(profile('Soporte técnico'))
  database.addResume({ name: 'Administración', originalName: 'cv-admin.pdf', pageCount: 1, extractedText: 'Experiencia administrativa', bytes: new Uint8Array(bytesOne) })
  database.addResume({ name: 'Soporte', originalName: 'cv-support.pdf', pageCount: 1, extractedText: 'Experiencia de soporte', bytes: new Uint8Array(bytesTwo) })

  const storedPdfs = fs.readdirSync(path.join(userData, 'resumes')).map((name) => fs.readFileSync(path.join(userData, 'resumes', name)))
  assert.equal(database.listProfiles().length, 2)
  assert.deepEqual(new Set(database.listProfiles().map((entry) => entry.minimumSalaryCurrency)), new Set(['ARS', 'USD']))
  assert.equal(database.listResumes().length, 2)
  assert.deepEqual(storedPdfs.map((bytes) => bytes.toString()).sort(), [bytesOne.toString(), bytesTwo.toString()].sort())
  assert.deepEqual(fs.readFileSync(originalOne), bytesOne)
  assert.deepEqual(fs.readFileSync(originalTwo), bytesTwo)
  database.close()
})

test('uses the configured optional AI API and requests a message based only on supplied facts', async (context) => {
  let received
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(body) }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Mensaje editable de prueba.' } }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  const settings = {
    searchIntervalHours: 4,
    backgroundSearchEnabled: false,
    aiEnabled: true,
    aiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    aiModel: 'test-model',
    aiApiKeyConfigured: true,
  }
  const message = await generateApplicationMessage(
    settings,
    'test-api-key',
    { title: 'Asistente', company: 'Empresa de prueba', location: 'Santa Fe', description: 'Experiencia en atención al cliente.' },
    'CV: atención al cliente.',
    { fullName: 'Persona de prueba', email: '', phone: '', location: 'Santa Fe', availability: '', mobility: '', summary: '', additionalFacts: '', updatedAt: null },
  )

  assert.equal(message, 'Mensaje editable de prueba.')
  assert.equal(received.path, '/v1/chat/completions')
  assert.equal(received.authorization, 'Bearer test-api-key')
  assert.equal(received.body.model, 'test-model')
  assert.match(received.body.messages[0].content, /No inventes/)
  assert.match(received.body.messages[1].content, /descripcionDelAviso/)
})

test('migrates existing profile and draft tables to the current copy fields', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-migration-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const file = path.join(directory, 'radar-laboral.sqlite')
  const previousVersion = new Database(file)
  previousVersion.exec(`
    CREATE TABLE search_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO search_profiles (id, name) VALUES ('old-profile', 'Perfil anterior');
    CREATE TABLE user_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, profile_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      automation_approved INTEGER NOT NULL DEFAULT 0,
      automation_evidence_url TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO user_sources (id, name, url, kind, enabled, automation_approved, automation_evidence_url, created_at)
    VALUES ('findjobit', 'Findjobit', 'https://findjobit.com/jobs/country/argentina/feed', 'rss', 1, 1, 'https://findjobit.com/rss-feed', '2026-01-01');
    INSERT INTO user_sources (id, name, url, kind, enabled, automation_approved, automation_evidence_url, created_at)
    VALUES ('custom-feed', 'Custom feed', 'https://example.com/jobs.xml', 'rss', 1, 1, 'https://example.com/terms', '2026-01-02');
    INSERT INTO user_sources (id, name, url, kind, enabled, created_at)
    VALUES ('manual-portal', 'Manual portal', 'https://jobs.example/', 'website', 1, '2026-01-03');
    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY, profile_id TEXT, title TEXT NOT NULL, company TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', url TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', salary_text TEXT NOT NULL DEFAULT '', match_score INTEGER,
      match_reasons TEXT NOT NULL DEFAULT '[]', missing_requirements TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'nueva', discovered_at TEXT NOT NULL, published_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO opportunities (id, title, company, url, discovered_at, created_at, updated_at)
    VALUES ('old-opportunity', 'Aviso anterior', 'Empresa anterior', 'https://example.com/old', '2026-01-01', '2026-01-01', '2026-01-01');
    CREATE TABLE application_drafts (
      id TEXT PRIMARY KEY,
      tailored_resume_html TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO application_drafts (id, tailored_resume_html) VALUES ('draft-1', 'Texto previo');
  `)
  previousVersion.close()

  const migrated = new RadarDatabase(directory)
  const migratedSources = migrated.listSources()
  const approvedFindjobit = migratedSources.find((source) => source.id === 'findjobit')
  const pausedCustomFeed = migratedSources.find((source) => source.id === 'custom-feed')
  const manualPortal = migratedSources.find((source) => source.id === 'manual-portal')
  const migratedOpportunity = migrated.getOpportunity('old-opportunity')
  assert.equal(approvedFindjobit.automationApproved, true)
  assert.equal(approvedFindjobit.automationPolicyId, 'findjobit-argentina-rss-2026-10-08')
  assert.equal(approvedFindjobit.automationPolicyReviewedOn, '2026-10-08')
  assert.equal(approvedFindjobit.enabled, true)
  assert.equal(approvedFindjobit.automationEvidenceUrl, 'https://findjobit.com/rss-feed')
  assert.equal(pausedCustomFeed.automationApproved, false)
  assert.equal(pausedCustomFeed.customAutomationApproved, false)
  assert.equal(pausedCustomFeed.enabled, false)
  assert.equal(pausedCustomFeed.automationEvidenceUrl, 'https://example.com/terms')
  assert.equal(manualPortal.enabled, true)
  assert.deepEqual(migrated.enabledSources().map((source) => source.id), ['findjobit'])
  assert.throws(() => migrated.updateSourceEnabled('custom-feed', true), /política vigente/u)
  assert.equal(migratedOpportunity.appliedDate, null)
  assert.equal(migratedOpportunity.followUpDate, null)
  assert.equal(migratedOpportunity.trackingNotes, '')
  migrated.close()

  const inspection = new Database(file, { readonly: true })
  const profileColumns = inspection.pragma('table_info(search_profiles)').map((column) => column.name)
  const oldProfileCurrency = inspection.prepare('SELECT minimum_salary_currency FROM search_profiles WHERE id = ?').get('old-profile')
  const oldProfileConversion = inspection.prepare('SELECT convert_salary_currencies FROM search_profiles WHERE id = ?').get('old-profile')
  const oldProfileWorkload = inspection.prepare('SELECT work_days_per_week, work_hours_per_week FROM search_profiles WHERE id = ?').get('old-profile')
  const oldProfileScheduleRule = inspection.prepare('SELECT require_schedule_match FROM search_profiles WHERE id = ?').get('old-profile')
  const oldProfileSalaryRule = inspection.prepare('SELECT require_salary_match FROM search_profiles WHERE id = ?').get('old-profile')
  const sourceColumns = inspection.pragma('table_info(user_sources)').map((column) => column.name)
  const opportunityColumns = inspection.pragma('table_info(opportunities)').map((column) => column.name)
  const draftColumns = inspection.pragma('table_info(application_drafts)').map((column) => column.name)
  const draft = inspection.prepare('SELECT resume_copy_text FROM application_drafts WHERE id = ?').get('draft-1')
  inspection.close()
  assert.ok(profileColumns.includes('search_description'))
  assert.ok(profileColumns.includes('minimum_salary_currency'))
  assert.ok(profileColumns.includes('convert_salary_currencies'))
  assert.ok(profileColumns.includes('work_days_per_week'))
  assert.ok(profileColumns.includes('work_hours_per_week'))
  assert.ok(profileColumns.includes('require_schedule_match'))
  assert.ok(profileColumns.includes('require_salary_match'))
  assert.equal(oldProfileCurrency.minimum_salary_currency, 'ARS')
  assert.equal(oldProfileConversion.convert_salary_currencies, 0)
  assert.equal(oldProfileWorkload.work_days_per_week, null)
  assert.equal(oldProfileWorkload.work_hours_per_week, null)
  assert.equal(oldProfileScheduleRule.require_schedule_match, 0)
  assert.equal(oldProfileSalaryRule.require_salary_match, 0)
  assert.ok(sourceColumns.includes('last_attempt_at'))
  assert.ok(sourceColumns.includes('last_error'))
  assert.ok(sourceColumns.includes('custom_automation_approved'))
  assert.ok(opportunityColumns.includes('applied_date'))
  assert.ok(opportunityColumns.includes('follow_up_date'))
  assert.ok(opportunityColumns.includes('follow_up_notified_for_date'))
  assert.ok(opportunityColumns.includes('tracking_notes'))
  assert.ok(sourceColumns.includes('config_json'))
  assert.ok(draftColumns.includes('resume_copy_text'))
  assert.equal(draft.resume_copy_text, 'Texto previo')
})

test('migrates the previous start-at-login preference to the background schedule', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-settings-migration-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const raw = new Database(path.join(directory, 'radar-laboral.sqlite'))
  raw.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('startAtLogin', 'true')
  raw.close()

  assert.equal(database.settings().backgroundSearchEnabled, true)
  const saved = database.saveSettings({
    searchIntervalHours: 8,
    backgroundSearchEnabled: false,
    aiEnabled: false,
    aiBaseUrl: '',
    aiModel: '',
  })
  assert.equal(saved.backgroundSearchEnabled, false)
  database.close()

  const inspection = new Database(path.join(directory, 'radar-laboral.sqlite'), { readonly: true })
  const savedSettings = inspection.prepare("SELECT key, value FROM app_settings WHERE key IN ('startAtLogin', 'backgroundSearchEnabled') ORDER BY key").all()
  inspection.close()
  assert.deepEqual(savedSettings, [{ key: 'backgroundSearchEnabled', value: 'false' }])
})

test('rejects non-HTTPS feeds and local network targets before making a request', async () => {
  await assert.rejects(testRssFeed('http://example.com/jobs.xml'), /HTTPS/)
  await assert.rejects(testRssFeed('https://127.0.0.1/jobs.xml'), /red local/)
  await assert.rejects(testRssFeed('https://service.localhost/jobs.xml'), /internet/)
  await assert.rejects(testCsvFeed('http://example.com/jobs.csv', { delimiter: ',', titleColumn: 'title', urlColumn: 'url' }), /HTTPS/u)
})

test('RSS, JSON, and CSV previews share the public HTTPS connector boundary', async () => {
  const jsonConfig = {
    itemsPath: '/jobs', titlePath: '/title', urlPath: '/url', descriptionPath: '', companyPath: '',
    locationPath: '', salaryPath: '', salaryMinimumPath: '', salaryMaximumPath: '',
    salaryCurrencyPath: '', salaryPeriodPath: '', publishedAtPath: '',
  }
  const csvConfig = {
    delimiter: ',', titleColumn: 'title', urlColumn: 'url', descriptionColumn: '', companyColumn: '',
    locationColumn: '', salaryColumn: '', salaryMinimumColumn: '', salaryMaximumColumn: '',
    salaryCurrencyColumn: '', salaryPeriodColumn: '', publishedAtColumn: '',
  }
  await assert.rejects(testConnector('rss', 'https://127.0.0.1/feed'), /direcciones de red local/u)
  await assert.rejects(testConnector('json', 'https://127.0.0.1/jobs', jsonConfig), /direcciones de red local/u)
  await assert.rejects(testConnector('csv', 'https://127.0.0.1/jobs.csv', csvConfig), /direcciones de red local/u)
})
test('saves settings and AI key atomically and guards vacancies with drafts', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-laboral-atomic-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const database = new RadarDatabase(directory)
  const saved = database.saveSettings({
    searchIntervalHours: 8,
    backgroundSearchEnabled: true,
    aiEnabled: true,
    aiBaseUrl: 'https://ai.example',
    aiModel: 'modelo',
  }, 'clave-cifrada')
  assert.equal(saved.aiEnabled, true)
  assert.equal(database.aiApiKeyEncrypted(), 'clave-cifrada')
  const opportunity = database.addOpportunity({
    profileId: null,
    title: 'Aviso con borrador',
    company: 'Empresa',
    location: '',
    source: 'Prueba',
    url: 'https://example.org/con-borrador',
    description: '',
    salaryText: '',
  })
  database.saveDraft({ opportunityId: opportunity.id, resumeId: null, message: 'Borrador', resumeCopyText: '' })
  assert.throws(() => database.removeOpportunity(opportunity.id), /borradores/u)
  database.close()
})

test('app updates stay disabled without a configured GitHub repo', () => {
  const source = resolveAppUpdateSource({})
  assert.equal(source.configured, false)
  assert.equal(resolveAppUpdateSource({ RADAR_UPDATE_GITHUB_OWNER: 'acme' }).configured, false)
  const real = resolveAppUpdateSource({ RADAR_UPDATE_GITHUB_OWNER: 'acme', RADAR_UPDATE_GITHUB_REPO: 'radar' })
  assert.deepEqual(real, { owner: 'acme', repo: 'radar', configured: true })

  const disabled = disabledAppUpdateState('falta repo')
  assert.equal(disabled.status, 'disabled')
  // disabled es terminal: ningún evento lo mueve.
  for (const event of [
    { type: 'check-started' },
    { type: 'update-available', version: '9.9.9' },
    { type: 'download-progress', percent: 50 },
    { type: 'update-downloaded', version: '9.9.9' },
    { type: 'up-to-date' },
    { type: 'error', detail: 'boom' },
  ]) {
    assert.equal(reduceAppUpdateEvent(disabled, event).status, 'disabled', JSON.stringify(event))
  }
})

test('app update reducer walks the download lifecycle in Spanish', () => {
  let state = initialAppUpdateState()
  assert.equal(state.status, 'idle')

  state = reduceAppUpdateEvent(state, { type: 'check-started' })
  assert.equal(state.status, 'checking')
  assert.match(state.message, /Buscando/u)

  state = reduceAppUpdateEvent(state, { type: 'update-available', version: '0.5.0' })
  assert.equal(state.status, 'available')
  assert.equal(state.version, '0.5.0')
  assert.match(state.message, /0\.5\.0/u)

  state = reduceAppUpdateEvent(state, { type: 'download-progress', percent: 42.6 })
  assert.equal(state.status, 'downloading')
  assert.equal(state.percent, 43)
  assert.match(state.message, /43%/u)

  state = reduceAppUpdateEvent(state, { type: 'update-downloaded', version: '0.5.0' })
  assert.equal(state.status, 'downloaded')
  assert.equal(state.percent, 100)
  assert.match(state.message, /al salir/u)

  // La descarga ganada se conserva: ni checking ni up-to-date la pisan.
  assert.equal(reduceAppUpdateEvent(state, { type: 'check-started' }).status, 'downloaded')
  assert.equal(reduceAppUpdateEvent(state, { type: 'up-to-date' }).status, 'downloaded')
  assert.equal(reduceAppUpdateEvent(state, { type: 'error', detail: 'x' }).status, 'downloaded')
})

test('app update reducer reports up-to-date and recoverable errors', () => {
  let state = reduceAppUpdateEvent(initialAppUpdateState(), { type: 'check-started' })
  state = reduceAppUpdateEvent(state, { type: 'up-to-date' })
  assert.equal(state.status, 'up-to-date')
  assert.match(state.message, /actualizado/u)

  // up-to-date no pisa una descarga en curso ni una disponible.
  const downloading = reduceAppUpdateEvent(
    reduceAppUpdateEvent(initialAppUpdateState(), { type: 'download-progress', percent: 10 }),
    { type: 'up-to-date' },
  )
  assert.equal(downloading.status, 'downloading')

  // Error recuperable: conserva la versión y permite reintentar.
  let failed = reduceAppUpdateEvent(initialAppUpdateState(), { type: 'error', detail: new Error('net down') })
  assert.equal(failed.status, 'error')
  assert.equal(failed.detail, 'net down')
  assert.match(failed.message, /conexi/u)
  failed = reduceAppUpdateEvent(failed, { type: 'check-started' })
  assert.equal(failed.status, 'checking')

  // Progreso inválido no rompe el estado.
  const weird = reduceAppUpdateEvent(initialAppUpdateState(), { type: 'download-progress', percent: Number.NaN })
  assert.equal(weird.status, 'downloading')
  assert.equal(weird.percent, null)

  // reset vuelve a idle.
  assert.equal(reduceAppUpdateEvent(failed, { type: 'reset' }).status, 'idle')
})

function createUpdateTestHarness({ packaged = true, feed = true, checkBehavior = 'available' } = {}) {
  const listeners = new Map()
  const sent = []
  const calls = { checks: 0, quits: 0, quitArguments: null }
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    async checkForUpdates() {
      calls.checks += 1
      if (checkBehavior === 'throw') throw new Error('offline')
      return null
    },
    async downloadUpdate() { return null },
    quitAndInstall(isSilent, isForceRunAfter) {
      calls.quits += 1
      calls.quitArguments = [isSilent, isForceRunAfter]
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return undefined
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
  const source = { owner: feed ? 'acme' : null, repo: feed ? 'radar' : null, configured: feed }
  const service = createAppUpdateService({
    updater,
    isPackaged: packaged,
    source,
    updateFeedConfigured: feed,
    log: () => {},
    getWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, state) => sent.push([channel, state]) } }],
  })
  return { service, updater, sent, calls }
}

test('app update service broadcasts states and installs only when downloaded', async () => {
  const { service, updater, sent, calls } = createUpdateTestHarness({
    feed: true,
  })
  assert.equal(service.state.status, 'idle')
  service.start()
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.autoInstallOnAppQuit, true)

  updater.emit('checking-for-update')
  assert.equal(service.state.status, 'checking')
  updater.emit('update-available', { version: '0.5.0' })
  assert.equal(service.state.status, 'available')
  updater.emit('download-progress', { percent: 25 })
  assert.equal(service.state.status, 'downloading')
  assert.equal(service.state.percent, 25)
  updater.emit('update-downloaded', { version: '0.5.0' })
  assert.equal(service.state.status, 'downloaded')

  // Cada transición emite por el canal documentado.
  assert.ok(sent.length >= 4)
  for (const [channel, state] of sent) {
    assert.equal(channel, 'app:update-state')
    assert.ok(state && typeof state.message === 'string' && state.message.length > 0)
  }

  service.quitAndInstall()
  assert.equal(calls.quits, 1)

  // checkForUpdates manual con descarga lista no regresa el estado.
  await service.checkForUpdates(true)
  assert.equal(service.state.status, 'downloaded')
})

test('app update service reports a rejected startup check as recoverable', async () => {
  const { service, updater, calls } = createUpdateTestHarness({ feed: true, checkBehavior: 'throw' })
  service.start()
  // electron-updater emits this before the network request can reject.
  updater.emit('checking-for-update')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.state.status, 'error')
  assert.equal(service.state.detail, 'offline')
  assert.equal(calls.checks, 1)

  await service.checkForUpdates(false)
  assert.equal(calls.checks, 1)
  await service.checkForUpdates(true)
  assert.equal(calls.checks, 2)
})

test('keeps update checks recoverable when electron-updater cannot load', () => {
  const mainSource = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const unavailableStart = mainSource.indexOf('function unavailableUpdater()')
  assert.ok(unavailableStart >= 0)
  assert.match(mainSource.slice(unavailableStart, unavailableStart + 400), /async checkForUpdates\(\)[\s\S]*throw new Error/u)
  assert.ok((mainSource.match(/updater = unavailableUpdater\(\)/gu) ?? []).length >= 2)
})

test('quits on Windows when the tray is unavailable and the last window closes', () => {
  const mainSource = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const handlerStart = mainSource.indexOf("app.on('window-all-closed'")
  assert.ok(handlerStart >= 0)
  assert.match(mainSource.slice(handlerStart, handlerStart + 350), /process\.platform === 'win32'[\s\S]*if \(!tray\) app\.quit\(\)/u)
  assert.match(mainSource.slice(handlerStart, handlerStart + 350), /process\.platform !== 'darwin'\) app\.quit\(\)/u)
})

test('keeps startup usable when creating the tray icon fails', () => {
  const mainSource = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const trayStart = mainSource.indexOf('function createTray()')
  const trayEnd = mainSource.indexOf('\nasync function updateBackgroundSchedule', trayStart)
  assert.ok(trayStart >= 0 && trayEnd > trayStart)
  const trayFactory = mainSource.slice(trayStart, trayEnd)
  assert.match(trayFactory, /catch \(error\)[\s\S]*tray = null[\s\S]*return false/u)
  assert.match(trayFactory, /la ventana seguir[aá] disponible/u)
})

test('app update leaves the user closed after choosing install and exit', () => {
  const { service, updater, calls } = createUpdateTestHarness({ feed: true })
  updater.emit('update-downloaded', { version: '0.5.0' })
  service.quitAndInstall()
  assert.equal(updater.autoRunAppAfterInstall, false)
  assert.deepEqual(calls.quitArguments, [false, false])
})

test('app update service guards quitAndInstall and throttles error retries', async () => {
  const { service, updater, calls } = createUpdateTestHarness({
    feed: true,
    checkBehavior: 'throw',
  })
  assert.throws(() => service.quitAndInstall(), /descargada/u)

  let now = 1_000_000
  const timed = createAppUpdateService({
    updater,
    isPackaged: true,
    source: { owner: 'acme', repo: 'radar', configured: true },
    updateFeedConfigured: true,
    log: () => {},
    getWindows: () => [],
    now: () => now,
  })
  await timed.checkForUpdates(true)
  assert.equal(timed.state.status, 'error')
  assert.equal(calls.checks, 1)

  // Reintento automático dentro de la hora: no pega a la red.
  await timed.checkForUpdates(false)
  assert.equal(calls.checks, 1)

  // Manual sí reintenta; automático tras una hora también.
  await timed.checkForUpdates(true)
  assert.equal(calls.checks, 2)
  now += 61 * 60 * 1000
  await timed.checkForUpdates(false)
  assert.equal(calls.checks, 3)
})

test('app update service disables itself in dev or without a repo', () => {
  const noRepo = createUpdateTestHarness({ feed: false })
  assert.equal(noRepo.service.state.status, 'disabled')
  assert.match(noRepo.service.state.message, /GitHub Releases/u)
  noRepo.service.start()

  const dev = createUpdateTestHarness({ packaged: false, feed: true })
  assert.equal(dev.service.state.status, 'disabled')
  const placeholderBuild = createUpdateTestHarness({ packaged: true, feed: false })
  assert.equal(placeholderBuild.service.state.status, 'disabled')
  assert.match(placeholderBuild.service.state.message, /GitHub Releases/u)
})
