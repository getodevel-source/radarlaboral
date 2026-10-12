/**
 * Verifica una actualización real entre dos releases de Windows usando el
 * botón de Preferencias. Instala la versión anterior en una carpeta temporal,
 * conserva una base SQLite sintética y confirma que la nueva app arranca.
 *
 * Uso: `node --experimental-strip-types scripts/smoke-in-app-update.mjs [from-version] [to-version] [install-dir]`
 * Si se pasa `install-dir`, actualiza esa instalación con un perfil de prueba aislado.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { extractFile, uncache as uncacheArchive } from '@electron/asar'
import { RadarDatabase } from '../electron/database.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const toVersion = process.argv[3] ?? manifest.version
const releaseRoot = path.join(root, 'release')
const compareVersions = (left, right) => {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}
const latestPreviousVersion = fs.readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/u.test(entry.name))
  .map((entry) => entry.name)
  .filter((version) => compareVersions(version, toVersion) < 0)
  .filter((version) => fs.existsSync(path.join(releaseRoot, version, `radarlaboral-Windows-${version}-Setup.exe`)))
  .sort(compareVersions)
  .at(-1)
const fromVersion = process.argv[2] ?? latestPreviousVersion ?? '0.4.146'
const existingInstallDir = process.argv[4] ? path.resolve(root, process.argv[4]) : null
assert.equal(toVersion, manifest.version, 'Target version must match the checked-out package')
assert.notEqual(fromVersion, toVersion, 'Source and target releases must differ')

const installer = path.join(releaseRoot, fromVersion, `radarlaboral-Windows-${fromVersion}-Setup.exe`)
const latestManifest = path.join(releaseRoot, toVersion, 'latest.yml')
const reportPath = path.join(releaseRoot, toVersion, 'QA-INAPP-UPDATE.json')
assert.ok(fs.existsSync(installer), `Missing source release installer: ${installer}`)
assert.ok(fs.existsSync(latestManifest), `Missing published target manifest: ${latestManifest}`)
if (existingInstallDir) assert.ok(fs.existsSync(path.join(existingInstallDir, 'Radar Laboral.exe')), `Missing installed app: ${existingInstallDir}`)
const latestText = fs.readFileSync(latestManifest, 'utf8')
assert.match(latestText, new RegExp(`^version: ${toVersion.replaceAll('.', '\\.')}\\s*$`, 'mu'))
assert.match(latestText, /signature:\s*[A-Za-z0-9+/=]+/u, 'Target update manifest must be signed')

const qaRoot = fs.mkdtempSync(path.join(os.tmpdir(), `radarlaboral-update-${fromVersion}-to-${toVersion}-`))
const installDir = existingInstallDir ?? path.join(qaRoot, 'installed-app')
const appDataRoot = path.join(qaRoot, 'appdata')
const userDataDir = path.join(appDataRoot, 'radarlaboral')
const installedExe = path.join(installDir, 'Radar Laboral.exe')
const profileId = 'qa-update-profile-preserved'
let activeApp = null
const appLogs = []
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
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Keep LOCALAPPDATA intact so NSIS resolves the already installed app and
    // uses the normal updater cache. The app database stays in the QA profile.
    env: { ...process.env, APPDATA: appDataRoot },
  })
  for (const stream of [activeApp.stdout, activeApp.stderr]) {
    stream?.setEncoding('utf8')
    stream?.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/u)) {
        if (/update|install|NSIS|error|quitandinstall/iu.test(line)) {
          appLogs.push(line)
          console.log(`App log: ${line}`)
        }
      }
    })
  }
  const target = await waitTarget(port, activeApp)
  const session = connectCdp(target.webSocketDebuggerUrl)
  await session.open
  await session.command('Runtime.enable')
  assert.equal(await session.eval('document.title'), 'Radar Laboral')
  const rendererDeadline = Date.now() + 20_000
  let rendererReady = false
  while (Date.now() < rendererDeadline) {
    rendererReady = await session.eval("Boolean(document.querySelector('button.nav-item span'))")
    if (rendererReady) break
    await delay(150)
  }
  assert.ok(rendererReady, 'Radar Laboral window opened before its navigation rendered')
  return session
}

async function closeApp(session) {
  session?.close()
  if (!activeApp || activeApp.exitCode !== null) return
  activeApp.kill()
  await waitExit(activeApp, 20_000, 'Radar Laboral shutdown').catch(() => {})
  activeApp = null
}

async function findReopenedAppWindow(exe) {
  const command = '$target = [System.IO.Path]::GetFullPath($env:RADAR_QA_INSTALLED_EXE); $items = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -ieq $target } | ForEach-Object { $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [PSCustomObject]@{ processId = $_.ProcessId; executablePath = $_.ExecutablePath; windowTitle = $process.MainWindowTitle } }); ConvertTo-Json -InputObject $items -Compress'
  const query = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, RADAR_QA_INSTALLED_EXE: exe },
  })
  let stdout = ''
  let stderr = ''
  query.stdout.setEncoding('utf8')
  query.stderr.setEncoding('utf8')
  query.stdout.on('data', (chunk) => { stdout += chunk })
  query.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await waitExit(query, 15_000, 'Updated app relaunch detection')
  if (result.code !== 0) throw new Error(`Could not inspect the updated app window: ${stderr}`)
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function waitForReopenedAppWindow(exe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const processes = await findReopenedAppWindow(exe)
    const window = processes.find((item) => item.windowTitle?.includes('Radar Laboral'))
    if (window) return window
    await delay(750)
  }
  return null
}

async function closeReopenedApp(processId) {
  const child = spawn('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  const result = await waitExit(child, 15_000, 'Updated QA app shutdown')
  assert.equal(result.code, 0, `Could not close the reopened QA app process ${processId}`)
}

try {
  if (existingInstallDir) {
    console.log(`Using the existing ${fromVersion} installation with an isolated profile: ${installDir}`)
  } else {
    console.log(`Installing ${fromVersion} into an isolated temporary directory…`)
    const setup = spawn(installer, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true })
    const setupResult = await waitExit(setup, 240_000, 'Source release installation')
    assert.equal(setupResult.code, 0, `Source installer failed: ${JSON.stringify(setupResult)}`)
  }
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
  let installButtonLabel = ''
  const downloadDeadline = Date.now() + 12 * 60_000
  while (Date.now() < downloadDeadline) {
    const status = await session.eval("(() => { const button = Array.from(document.querySelectorAll('.settings-card button')).find(button => /^(Instalar y reiniciar|Instalar y salir)/u.test(button.innerText.trim())); return { message: document.querySelector('.settings-card p[role=\"status\"]')?.innerText.trim() ?? '', installButtonLabel: button?.innerText.trim() ?? '', progress: document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') ?? null }; })()")
    if (status.message !== lastMessage) {
      console.log(`Update status: ${status.message}${status.progress !== null ? ` (${status.progress}%)` : ''}`)
      lastMessage = status.message
    }
    if (/No se pudo buscar la actualizaciÃ³n|No se pudo buscar la actualización/u.test(status.message)) {
      throw new Error(`The in-app updater failed: ${status.message}`)
    }
    if (status.message.includes(toVersion) && status.installButtonLabel) {
      downloaded = true
      installButtonLabel = status.installButtonLabel
      break
    }
    if (status.message.includes('está actualizado') || status.message.includes('esta actualizado')) {
      throw new Error(`The ${fromVersion} installation reported up-to-date while ${toVersion} is published`)
    }
    await delay(750)
  }
  assert.ok(downloaded, `The in-app updater did not finish downloading ${toVersion} within 12 minutes`)

  await session.eval("Array.from(document.querySelectorAll('.settings-card button')).find(button => /^(Instalar y reiniciar|Instalar y salir)/u.test(button.innerText.trim()))?.click()")
  const oldApp = activeApp
  const appExit = await waitExit(oldApp, 90_000, 'In-app quit-and-install')
  assert.equal(appExit.code, 0, `The old app did not exit cleanly for installation: ${JSON.stringify(appExit)}`)
  activeApp = null
  session.close()
  session = null

  const updaterInstallLog = appLogs.find((line) => /Install: isSilent: true, isForceRunAfter: (?:true|false)/u.test(line))
  assert.ok(updaterInstallLog, 'The updater did not launch NSIS in silent mode')
  const updaterRequestedRestart = /isForceRunAfter: true/u.test(updaterInstallLog)
  console.log(`The old app exited through “${installButtonLabel}” (force-run requested: ${updaterRequestedRestart}); waiting for NSIS to replace the installed version…`)
  const installDeadline = Date.now() + 120_000
  let lastInstallLog = 0
  let upgradedPackage = null
  while (Date.now() < installDeadline) {
    try {
      // @electron/asar caches the first archive header per path. NSIS replaces
      // app.asar in place, so drop that cache before checking the new package.
      uncacheArchive(appArchive)
      upgradedPackage = JSON.parse(extractFile(appArchive, 'package.json').toString('utf8'))
      if (upgradedPackage.version === toVersion) break
    } catch {}
    if (Date.now() - lastInstallLog >= 5_000) {
      console.log(`Waiting for NSIS to finish; installed package is ${upgradedPackage?.version ?? 'not readable yet'}.`)
      lastInstallLog = Date.now()
    }
    await delay(1_000)
  }
  assert.equal(upgradedPackage?.version, toVersion, 'The in-app installer did not replace the isolated app with the target version')
  console.log(`NSIS replaced the installed package with ${upgradedPackage.version}.`)

  const reopenedAppWindow = await waitForReopenedAppWindow(installedExe)
  assert.ok(reopenedAppWindow, 'The updated app did not reopen in a visible window after NSIS completed')
  assert.equal(path.resolve(reopenedAppWindow.executablePath).toLowerCase(), path.resolve(installedExe).toLowerCase(), 'A different Radar Laboral installation reopened after the update')
  console.log(`The updated app reopened automatically in window “${reopenedAppWindow.windowTitle}”.`)
  await closeReopenedApp(reopenedAppWindow.processId)

  const upgradedDatabase = new RadarDatabase(userDataDir)
  const preservedProfiles = upgradedDatabase.listProfiles()
  upgradedDatabase.close()
  assert.ok(preservedProfiles.some((profile) => profile.id === profileId && profile.name === 'Perfil de prueba de actualización'), 'The app update did not preserve the isolated user database')
  console.log(`SQLite preserved the synthetic profile (${preservedProfiles.length} profile(s)).`)

  port = await choosePort()
  console.log(`Starting ${toVersion} again with the same isolated profile.`)
  session = await openApp(installedExe, port)
  const preferencesOpened = await session.eval("(() => { const button = Array.from(document.querySelectorAll('button.nav-item')).find(item => item.querySelector('span')?.innerText.trim() === 'Preferencias'); if (!button) return false; button.click(); return true; })()")
  assert.ok(preferencesOpened, 'Updated app did not render the Preferences navigation button')
  const versionDeadline = Date.now() + 10_000
  let versionLine = ''
  while (Date.now() < versionDeadline) {
    versionLine = await session.eval("document.querySelector('.version-line')?.innerText.trim() ?? ''")
    if (versionLine.includes(toVersion)) break
    await delay(200)
  }
  assert.ok(versionLine.includes(toVersion), `Updated app did not start as ${toVersion}: ${versionLine}`)
  console.log(`Updated Preferences reports ${versionLine}.`)
  const installedBrandImage = extractFile(appArchive, 'resources/brand-icon.png')
  assert.deepEqual(installedBrandImage, fs.readFileSync(path.join(root, 'resources', 'brand-icon.png')), 'The updated package does not contain the exact transparent master icon')
  const updateStatusDeadline = Date.now() + 30_000
  let updateStatus = ''
  while (Date.now() < updateStatusDeadline) {
    updateStatus = await session.eval("document.querySelector('.settings-card p[role=\"status\"]')?.innerText.trim() ?? ''")
    if (updateStatus.includes('actualizado')) break
    await delay(250)
  }
  assert.match(updateStatus, /actualizado/u, `Updated app did not report its current status: ${updateStatus}`)
  await closeApp(session)
  session = null

  const report = {
    fromVersion,
    toVersion,
    releaseManifestSigned: true,
    installationMode: existingInstallDir ? 'existing-install-with-isolated-profile' : 'isolated-install',
    sourceInstallerSha256: sha256(installer),
    targetInstallerSha256: sha256(path.join(releaseRoot, toVersion, `radarlaboral-Windows-${toVersion}-Setup.exe`)),
    inAppCheckButtonClicked: manualCheckClicked,
    downloadedInApp: downloaded,
    sourceInstallButton: installButtonLabel,
    updaterRequestedForceRun: updaterRequestedRestart,
    installedTargetVersion: upgradedPackage.version,
    updatedAppStarted: true,
    automaticRelaunchWindowDetected: true,
    automaticRelaunchWindowTitle: reopenedAppWindow.windowTitle,
    preservedSyntheticProfiles: preservedProfiles.length,
    syntheticProfilePreserved: true,
    installedBrandArtworkMatchesMaster: true,
    installedBrandArtworkSha256: sha256(path.join(root, 'resources', 'brand-icon.png')),
    updaterStatusAfterRestart: updateStatus,
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
