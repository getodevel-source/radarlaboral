/**
 * Verifica una actualización real entre dos releases de Windows usando el
 * botón de Preferencias. Instala la versión anterior en una carpeta temporal,
 * conserva una base SQLite sintética y confirma que la nueva app arranca.
 *
 * Uso: `node --experimental-strip-types scripts/smoke-in-app-update.mjs [from-version] [to-version]`
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { extractFile } from '@electron/asar'
import { RadarDatabase } from '../electron/database.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const fromVersion = process.argv[2] ?? '0.4.144'
const toVersion = process.argv[3] ?? manifest.version
assert.equal(toVersion, manifest.version, 'Target version must match the checked-out package')
assert.notEqual(fromVersion, toVersion, 'Source and target releases must differ')

const installer = path.join(root, 'release', fromVersion, `radarlaboral-Windows-${fromVersion}-Setup.exe`)
const latestManifest = path.join(root, 'release', toVersion, 'latest.yml')
const reportPath = path.join(root, 'release', toVersion, 'QA-INAPP-UPDATE.json')
assert.ok(fs.existsSync(installer), `Missing source release installer: ${installer}`)
assert.ok(fs.existsSync(latestManifest), `Missing published target manifest: ${latestManifest}`)
const latestText = fs.readFileSync(latestManifest, 'utf8')
assert.match(latestText, new RegExp(`^version: ${toVersion.replaceAll('.', '\\.')}\\s*$`, 'mu'))
assert.match(latestText, /signature:\s*[A-Za-z0-9+/=]+/u, 'Target update manifest must be signed')

const qaRoot = fs.mkdtempSync(path.join(os.tmpdir(), `radarlaboral-update-${fromVersion}-to-${toVersion}-`))
const installDir = path.join(qaRoot, 'installed-app')
const appDataRoot = path.join(qaRoot, 'appdata')
const localAppDataRoot = path.join(qaRoot, 'local-app-data')
const userDataDir = path.join(appDataRoot, 'radarlaboral')
const installedExe = path.join(installDir, 'Radar Laboral.exe')
const profileId = 'qa-update-profile-preserved'
let activeApp = null
let success = false

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function waitExit(child, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => reject(new Error(`${description} exceeded ${timeoutMs} ms`)), timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  })
}

async function choosePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function connectCdp(url) {
  const socket = new WebSocket(url)
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(event.data.toString()) } catch { return }
    if (!message.id) {
      if (message.method === 'Runtime.exceptionThrown') {
        console.error('Renderer exception:', message.params.exceptionDetails.text, message.params.exceptionDetails.exception?.description ?? '')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        console.error('Renderer console error:', message.params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '))
      }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
  })
  return {
    open: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }),
    close: () => socket.close(),
    command(method, params = {}) {
      const requestId = ++id
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    },
    eval(expression) {
      return this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((result) => {
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
        return result.result.value
      })
    },
  }
}

async function waitTarget(port, child) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Radar Laboral exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const target = targets.find((item) => item.type === 'page' && item.title === 'Radar Laboral' && item.url.startsWith('file:') && item.webSocketDebuggerUrl)
        if (target) return target
      }
    } catch {}
    await delay(250)
  }
  throw new Error('Radar Laboral did not expose a renderer for the isolated QA profile')
}

async function openApp(exe, port) {
  activeApp = spawn(exe, [`--radar-user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, APPDATA: appDataRoot, LOCALAPPDATA: localAppDataRoot },
  })
  const target = await waitTarget(port, activeApp)
  const session = connectCdp(target.webSocketDebuggerUrl)
  await session.open
  await session.command('Runtime.enable')
  assert.equal(await session.eval('document.title'), 'Radar Laboral')
  return session
}

async function closeApp(session) {
  session?.close()
  if (!activeApp || activeApp.exitCode !== null) return
  activeApp.kill()
  await waitExit(activeApp, 20_000, 'Radar Laboral shutdown').catch(() => {})
  activeApp = null
}

function stopIsolatedAppProcesses() {
  const command = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:RADAR_QA_ISOLATED_EXE } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, RADAR_QA_ISOLATED_EXE: installedExe },
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Could not stop the isolated app after its updater relaunch: ${result.stderr}`)
}

try {
  console.log(`Installing ${fromVersion} into an isolated temporary directory…`)
  const setup = spawn(installer, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true })
  const setupResult = await waitExit(setup, 240_000, 'Source release installation')
  assert.equal(setupResult.code, 0, `Source installer failed: ${JSON.stringify(setupResult)}`)
  assert.ok(fs.existsSync(installedExe), 'Source installer did not place Radar Laboral.exe in the isolated directory')

  const appArchive = path.join(installDir, 'resources', 'app.asar')
  const installedPackage = JSON.parse(extractFile(appArchive, 'package.json').toString('utf8'))
  assert.equal(installedPackage.version, fromVersion, 'The isolated source installation has the wrong version')

  const database = new RadarDatabase(userDataDir)
  database.saveProfile({
    name: 'Perfil de prueba de actualización',
    searchDescription: 'Dato sintético para confirmar que la actualización conserva la base local.',
    roles: ['atención al cliente'],
    locations: ['Rosario, Santa Fe'],
    radiusKm: 25,
    includeKeywords: [],
    excludeKeywords: [],
    workMode: 'indistinto',
    schedule: '',
    requireScheduleMatch: false,
    workDaysPerWeek: null,
    workHoursPerWeek: null,
    minimumSalary: null,
    minimumSalaryCurrency: 'ARS',
    requireSalaryMatch: false,
    convertSalaryCurrencies: false,
    active: true,
  }, profileId)
  database.close()
  const databasePath = path.join(userDataDir, 'radar-laboral.sqlite')
  assert.ok(fs.existsSync(databasePath), 'The isolated source installation did not create its local database')

  let port = await choosePort()
  let session = await openApp(installedExe, port)
  await session.eval("Array.from(document.querySelectorAll('button.nav-item')).find(button => button.querySelector('span')?.innerText.trim() === 'Preferencias')?.click()")

  const checkDeadline = Date.now() + 20_000
  let checkButton = null
  while (Date.now() < checkDeadline) {
    checkButton = await session.eval("Array.from(document.querySelectorAll('.settings-card button')).find(button => button.innerText.trim() === 'Buscar actualizaciones') ? { text: Array.from(document.querySelectorAll('.settings-card button')).find(button => button.innerText.trim() === 'Buscar actualizaciones').innerText.trim(), disabled: Array.from(document.querySelectorAll('.settings-card button')).find(button => button.innerText.trim() === 'Buscar actualizaciones').disabled } : null")
    if (checkButton) break
    await delay(200)
  }
  assert.ok(checkButton, 'Preferences did not show the in-app update check button')
  let manualCheckClicked = false
  if (!checkButton.disabled) {
    await session.eval("Array.from(document.querySelectorAll('.settings-card button')).find(button => button.innerText.trim() === 'Buscar actualizaciones')?.click()")
    manualCheckClicked = true
  }
  console.log(`In-app update check button ${manualCheckClicked ? 'clicked' : 'already busy with startup check'}; waiting for signed download…`)

  let lastMessage = ''
  let downloaded = false
  const downloadDeadline = Date.now() + 12 * 60_000
  while (Date.now() < downloadDeadline) {
    const status = await session.eval("(() => ({ message: document.querySelector('.settings-card p[role=\"status\"]')?.innerText.trim() ?? '', installVisible: Array.from(document.querySelectorAll('.settings-card button')).some(button => button.innerText.trim().startsWith('Instalar y salir')), progress: document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') ?? null }))()")
    if (status.message !== lastMessage) {
      console.log(`Update status: ${status.message}${status.progress !== null ? ` (${status.progress}%)` : ''}`)
      lastMessage = status.message
    }
    if (/No se pudo buscar la actualizaciÃ³n|No se pudo buscar la actualización/u.test(status.message)) {
      throw new Error(`The in-app updater failed: ${status.message}`)
    }
    if (status.message.includes(toVersion) && status.installVisible) {
      downloaded = true
      break
    }
    if (status.message.includes('está actualizado') || status.message.includes('esta actualizado')) {
      throw new Error(`The ${fromVersion} installation reported up-to-date while ${toVersion} is published`)
    }
    await delay(750)
  }
  assert.ok(downloaded, `The in-app updater did not finish downloading ${toVersion} within 12 minutes`)

  await session.eval("Array.from(document.querySelectorAll('.settings-card button')).find(button => button.innerText.trim().startsWith('Instalar y salir'))?.click()")
  const oldApp = activeApp
  const appExit = await waitExit(oldApp, 90_000, 'In-app quit-and-install')
  assert.equal(appExit.code, 0, `The old app did not exit cleanly for installation: ${JSON.stringify(appExit)}`)
  activeApp = null
  session.close()
  session = null

  console.log('The old app exited through “Instalar y salir”; waiting for NSIS to replace the installed version…')
  const installDeadline = Date.now() + 240_000
  let upgradedPackage = null
  while (Date.now() < installDeadline) {
    try {
      upgradedPackage = JSON.parse(extractFile(appArchive, 'package.json').toString('utf8'))
      if (upgradedPackage.version === toVersion) break
    } catch {}
    await delay(1_000)
  }
  assert.equal(upgradedPackage?.version, toVersion, 'The in-app installer did not replace the isolated app with the target version')

  // NSIS can start the updated app with --updated and omit the custom test flag.
  // Its inherited APPDATA points into this throwaway profile so the relaunch
  // remains isolated; stop only processes launched from this test install path.
  stopIsolatedAppProcesses()

  const upgradedDatabase = new RadarDatabase(userDataDir)
  const preservedProfiles = upgradedDatabase.listProfiles()
  upgradedDatabase.close()
  assert.ok(preservedProfiles.some((profile) => profile.id === profileId && profile.name === 'Perfil de prueba de actualización'), 'The app update did not preserve the isolated user database')

  port = await choosePort()
  session = await openApp(installedExe, port)
  await session.eval("Array.from(document.querySelectorAll('button.nav-item')).find(button => button.querySelector('span')?.innerText.trim() === 'Preferencias')?.click()")
  const versionDeadline = Date.now() + 10_000
  let versionLine = ''
  while (Date.now() < versionDeadline) {
    versionLine = await session.eval("document.querySelector('.version-line')?.innerText.trim() ?? ''")
    if (versionLine.includes(toVersion)) break
    await delay(200)
  }
  assert.ok(versionLine.includes(toVersion), `Updated app did not start as ${toVersion}: ${versionLine}`)
  await closeApp(session)
  session = null

  const report = {
    fromVersion,
    toVersion,
    releaseManifestSigned: true,
    sourceInstallerSha256: sha256(installer),
    inAppCheckButtonClicked: manualCheckClicked,
    downloadedInApp: downloaded,
    installedTargetVersion: upgradedPackage.version,
    updatedAppStarted: true,
    preservedSyntheticProfiles: preservedProfiles.length,
    syntheticProfilePreserved: true,
    isolatedAppDataUsed: true,
    temporaryProfileUsed: true,
    completedAt: new Date().toISOString(),
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, report: path.relative(root, reportPath) }, null, 2))
  success = true
} finally {
  if (activeApp && activeApp.exitCode === null) {
    activeApp.kill()
    await waitExit(activeApp, 20_000, 'QA app cleanup').catch(() => {})
  }
  if (success) fs.rmSync(qaRoot, { recursive: true, force: true })
  else console.error(`QA files retained for inspection: ${qaRoot}`)
}
