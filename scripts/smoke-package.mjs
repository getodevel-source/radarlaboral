import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import * as asar from '@electron/asar'
import { RadarDatabase } from '../electron/database.ts'
import { localDateString } from '../src/shared/local-date.ts'

const root = process.cwd()
const execFileAsync = promisify(execFile)
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = manifest.version
const release = process.env.RADAR_PACKAGE_OUTPUT_DIR
  ? path.resolve(root, process.env.RADAR_PACKAGE_OUTPUT_DIR)
  : path.join(root, 'release', version)
const installer = path.join(release, `Radar Laboral-Windows-${version}-Setup.exe`)
const unpacked = path.join(release, 'win-unpacked')
const executable = path.join(unpacked, 'Radar Laboral.exe')
const archive = path.join(unpacked, 'resources', 'app.asar')
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const qaRoot = path.join(root, `.qa-package-${version}-${runId}`)
const installDir = path.join(qaRoot, 'install')
const userDataDir = path.join(qaRoot, 'user-data')
assert.ok(fs.existsSync(installer), `Build the NSIS installer first: ${installer}`)
assert.equal(fs.existsSync(qaRoot), false, 'QA output path already exists')
fs.mkdirSync(userDataDir, { recursive: true })
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

function assertMarkdownLinksExist(markdownPath, installedMarkdownPath) {
  const markdown = fs.readFileSync(markdownPath, 'utf8')
  let checkedLinks = 0
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu)) {
    let target = match[1].replace(/^<|>$/gu, '')
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target) || target.startsWith('#')) continue
    target = target.split(/[?#]/u, 1)[0]
    if (!target) continue
    let decodedTarget
    try {
      decodedTarget = decodeURIComponent(target)
    } catch {
      decodedTarget = target
    }
    const resolvedTarget = path.resolve(path.dirname(installedMarkdownPath), decodedTarget)
    assert.ok(fs.existsSync(resolvedTarget), `Broken installed Markdown link in ${path.relative(root, markdownPath)}: ${target}`)
    checkedLinks++
  }
  return checkedLinks
}

function waitExit(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Process exceeded timeout')), timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

function taskSnapshot() {
  const command = "$t=Get-ScheduledTask -TaskName 'RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch' -ErrorAction SilentlyContinue; if ($null -eq $t) { '[]' } else { ConvertTo-Json -Compress -InputObject @($t | Select-Object TaskName,State) }"
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim() || '[]')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitTarget(port, child) {
  const end = Date.now() + 45_000
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Radar exited with code ${child.exitCode}`)
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
  throw new Error('Installed renderer did not appear in CDP')
}

async function waitNativeNotification(timeoutMs = 8_000) {
  const title = 'Tenés seguimientos pendientes'
  const body = 'Llegó la fecha para retomar una postulación. Abrí Radar Laboral para revisarla.'
  const quote = (value) => `'${value.replaceAll("'", "''")}'`
  const command = `
Add-Type -AssemblyName UIAutomationClient
$title = ${quote(title)}
$body = ${quote(body)}
$pushSettings = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' -ErrorAction SilentlyContinue
$globalToastEnabled = if ($null -eq $pushSettings) { $null } else { $pushSettings.ToastEnabled }
$end = [DateTime]::UtcNow.AddMilliseconds(${timeoutMs})
$matches = @()
while ([DateTime]::UtcNow -lt $end) {
  try {
    $nodes = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($node in $nodes) {
      try {
        $name = [string]$node.Current.Name
        if ($name -eq $title -or $name -eq $body) { $matches += $name }
      } catch {}
    }
  } catch {}
  if ($matches.Count -gt 0) { break }
  Start-Sleep -Milliseconds 200
}
[pscustomobject]@{ observed = ($matches.Count -gt 0); matchedNames = @($matches | Select-Object -Unique); globalToastEnabled = $globalToastEnabled } | ConvertTo-Json -Compress
`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    timeout: timeoutMs + 10_000,
    windowsHide: true,
  })
  return JSON.parse(stdout.trim())
}

function cdp(url) {
  const socket = new WebSocket(url)
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(event.data.toString()) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
  })
  return {
    socket,
    open: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }),
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

function signature(file) {
  const escaped = file.replaceAll("'", "''")
  const command = `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString()`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const status = result.stdout.trim()
  assert.ok(status === 'Valid' || status === 'NotSigned', `Unexpected Authenticode status: ${status}`)
  return status
}

async function readWindowsNotificationShortcut(targetPath) {
  const escapedTarget = targetPath.replaceAll("'", "''")
  const command = `
$target = '${escapedTarget}'
$programs = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
$shell = New-Object -ComObject Shell.Application
$shortcuts = New-Object -ComObject WScript.Shell
$matches = @()
if (Test-Path -LiteralPath $programs) {
  Get-ChildItem -LiteralPath $programs -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $link = $shortcuts.CreateShortcut($_.FullName)
      if ([String]::Equals([IO.Path]::GetFullPath($link.TargetPath), [IO.Path]::GetFullPath($target), [StringComparison]::OrdinalIgnoreCase)) {
        $folder = $shell.Namespace($_.DirectoryName)
        $item = $folder.ParseName($_.Name)
        $matches += [pscustomobject]@{
          path = $_.FullName
          appUserModelId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
          toastActivatorClsid = [string]$item.ExtendedProperty('System.AppUserModel.ToastActivatorCLSID')
        }
      }
    } catch {}
  }
}
ConvertTo-Json -Compress -InputObject @($matches)
`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    const parsed = JSON.parse(stdout.trim() || '[]')
    return Array.isArray(parsed) ? parsed[0] ?? null : parsed
  } catch (error) {
    return { probeError: String(error), appUserModelId: null, toastActivatorClsid: null }
  }
}

for (const file of [installer, `${installer}.blockmap`, executable, archive]) assert.ok(fs.existsSync(file), `Missing ${file}`)
const entries = asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/'))
const archivedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
assert.equal(archivedManifest.version, version)
const archivedMain = asar.extractFile(archive, 'dist-electron/main.js').toString('utf8')
assert.match(archivedMain, /commandLine\.appendSwitch\(["']lang["'],\s*["']es-AR["']\)/u)
assert.match(archivedMain, /setAppUserModelId/u)
assert.match(archivedMain, /ar\.radarlaboral\.desktop/u)
assert.match(archivedMain, /setToastActivatorCLSID/u)
assert.match(archivedMain, /017378BE-4BF1-42DA-A318-80EDED2C1A4B/iu)
assert.match(archivedMain, /api\.bcra\.gob\.ar\/estadisticascambiarias\/v1\.0\/Cotizaciones/u)
assert.match(archivedMain, /token:\s*"cookunity"/u)
assert.match(archivedMain, /hostname:\s*"careers\.cookunity\.com"/u)
assert.match(archivedMain, /pathname:\s*"\/open-roles"/u)
assert.match(archivedMain, /jobIdQueryParam:\s*"gh_jid"/u)
assert.match(archivedMain, /token:\s*"dept"/u)
assert.match(archivedMain, /company:\s*"DEPT®"/u)
assert.match(archivedMain, /evidenceUrl:\s*"https:\/\/www\.dept\.global\/latam\/trabajar-en-dept\/empleos\/"/u)
assert.ok(archivedMain.includes('split(/[/?#]/u, 1)[0].includes("@")'))
const cookUnityPolicyIncluded = true
const deptPolicyIncluded = true
const greenhouseUserinfoGuardIncluded = true
assert.ok(entries.includes('/dist/index.html'))
assert.ok(entries.includes('/dist-electron/main.js'))
const toolchainModulesExcluded = {
  sprintfJs: !entries.some((entry) => entry.includes('/sprintf-js/')),
  roarr: !entries.some((entry) => entry.includes('/roarr/')),
  globalAgent: !entries.some((entry) => entry.includes('/global-agent/')),
  electronGet: !entries.some((entry) => entry.includes('/@electron/get/')),
}
assert.ok(!entries.some((entry) => entry.startsWith('/tests/')), 'Package includes tests')
assert.ok(Object.values(toolchainModulesExcluded).every(Boolean), 'Package includes an audited build-tool module')
const html = asar.extractFile(archive, 'dist/index.html').toString('utf8')
assert.match(html, /connect-src 'self'/u)
assert.doesNotMatch(html, /127\.0\.0\.1:5173/u)

const documentationFiles = listFiles(path.join(root, 'docs'))
for (const sourceFile of documentationFiles) {
  const installedFile = path.join(unpacked, path.relative(root, sourceFile))
  assert.equal(hash(sourceFile), hash(installedFile), `Documentation differs: ${path.relative(root, sourceFile)}`)
}
const markdownFiles = [path.join(root, 'README.md'), ...documentationFiles.filter((file) => file.endsWith('.md'))]
assert.equal(hash(path.join(root, 'LICENSE')), hash(path.join(unpacked, 'LICENSE')))
let markdownLinksChecked = 0
for (const sourceFile of markdownFiles) {
  const installedFile = path.join(unpacked, path.relative(root, sourceFile))
  assert.equal(hash(sourceFile), hash(installedFile), `Markdown differs: ${path.relative(root, sourceFile)}`)
  markdownLinksChecked += assertMarkdownLinksExist(sourceFile, installedFile)
}
const packagedEvidenceFiles = listFiles(path.join(unpacked, 'package-evidence')).filter((file) => /^QA-.*\.(?:json|png)$/u.test(path.basename(file)) || path.basename(file) === 'SHA256SUMS.txt')
assert.ok(packagedEvidenceFiles.length > 0, 'Package is missing linked QA evidence')
const sourceEvidenceFiles = listFiles(path.join(root, 'package-evidence')).filter((file) => /^QA-.*\.(?:json|png)$/u.test(path.basename(file)) || path.basename(file) === 'SHA256SUMS.txt')
assert.equal(packagedEvidenceFiles.length, sourceEvidenceFiles.length, 'Package evidence file count differs from source')
for (const name of ['QA-PACKAGE.json', 'QA-FORCED-COLORS.png', 'SHA256SUMS.txt']) {
  assert.ok(!fs.existsSync(path.join(unpacked, 'package-evidence', version, name)), `Package includes current-version smoke output: ${name}`)
}
for (const sourceFile of sourceEvidenceFiles) {
  const installedFile = path.join(unpacked, path.relative(root, sourceFile))
  assert.equal(hash(sourceFile), hash(installedFile), `Package evidence differs: ${path.relative(root, sourceFile)}`)
}
const packagedEvidenceBytes = packagedEvidenceFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
const packagedAudit = fs.readFileSync(path.join(unpacked, 'docs', 'mvp-audit.md'), 'utf8')
assert.match(packagedAudit, new RegExp(version.replaceAll('.', '\\.'), 'u'))

const beforeTask = taskSnapshot()
const install = spawn(installer, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true })
assert.equal(await waitExit(install), 0, 'NSIS installer failed')
const installedExe = path.join(installDir, 'Radar Laboral.exe')
assert.ok(fs.existsSync(installedExe))

const syntheticDatabase = new RadarDatabase(userDataDir)
const today = localDateString()
const reminder = syntheticDatabase.addOpportunity({
  profileId: null,
  title: 'QA reminder',
  company: 'Synthetic employer',
  location: '',
  source: 'Synthetic QA',
  url: `https://example.org/qa-reminder/${runId}`,
  description: '',
  salaryText: '',
})
syntheticDatabase.updateOpportunityStatus(reminder.id, 'postulada')
syntheticDatabase.updateOpportunityTracking(reminder.id, { appliedDate: today, followUpDate: today, trackingNotes: '' })
const searchNotificationSource = syntheticDatabase.addSource({
  name: 'QA Search Notification',
  url: 'https://127.0.0.1:9/radar-search-notification.xml',
  kind: 'rss',
  profileId: null,
  enabled: false,
  customAutomationApproved: true,
  automationEvidenceUrl: '',
  jsonConfig: null,
  csvConfig: null,
})
syntheticDatabase.close()

const server = net.createServer()
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
const remotePort = server.address().port
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
const app = spawn(installedExe, [`--radar-user-data-dir=${userDataDir}`, `--remote-debugging-port=${remotePort}`], { stdio: 'ignore', windowsHide: true })
const nativeNotificationPromise = waitNativeNotification()
const target = await waitTarget(remotePort, app)
const notificationShortcut = await readWindowsNotificationShortcut(installedExe)
const session = cdp(target.webSocketDebuggerUrl)
await session.open
assert.equal(await session.eval('document.title'), 'Radar Laboral')
let inAppReminderText = ''
const fallbackDeadline = Date.now() + 8_000
while (Date.now() < fallbackDeadline && !inAppReminderText) {
  inAppReminderText = await session.eval("document.querySelector('.toast-message')?.innerText || ''")
  if (!inAppReminderText) await delay(200)
}
const inAppFallbackAccessibility = await session.eval(`(() => {
  const region = document.querySelector('.visually-hidden[role="status"][aria-live="polite"][aria-atomic="true"]')
  const visualToast = document.querySelector('.toast-message')
  return {
    role: region?.getAttribute('role') ?? null,
    ariaLive: region?.getAttribute('aria-live') ?? null,
    ariaAtomic: region?.getAttribute('aria-atomic') ?? null,
    announcementText: region?.innerText ?? '',
    visualToastAriaHidden: visualToast?.getAttribute('aria-hidden') ?? null,
  }
})()`)
const nativeNotification = await nativeNotificationPromise
const databaseForSearchNotification = new RadarDatabase(userDataDir)
assert.equal(databaseForSearchNotification.updateSourceEnabled(searchNotificationSource.id, true)?.enabled, true)
databaseForSearchNotification.close()
const searchResult = await session.eval('window.radar.app.runSearch()')
assert.equal(searchResult.checkedSources, 1, 'The synthetic source did not reach the installed search pipeline')
assert.equal(searchResult.added, 0, 'The private synthetic endpoint unexpectedly added a vacancy')
assert.equal(searchResult.errors.length, 1, 'The private synthetic endpoint was not rejected by the search pipeline')
assert.match(searchResult.errors[0].message, /p.blica|privada|loopback/u, 'The synthetic endpoint was not blocked by the public-address boundary')
let inAppSearchCompletionText = ''
if (nativeNotification.globalToastEnabled === 0) {
  const searchNoticeDeadline = Date.now() + 8_000
  while (Date.now() < searchNoticeDeadline && !inAppSearchCompletionText) {
    inAppSearchCompletionText = await session.eval("document.querySelector('.toast-message')?.innerText || ''")
    if (!inAppSearchCompletionText) await delay(200)
  }
  assert.match(inAppSearchCompletionText, /Falló la consulta de 1 fuente\. Revisá Fuentes\./u, 'The installed renderer did not display the search-completion fallback')
  assert.doesNotMatch(inAppSearchCompletionText, /QA Search Notification|127\.0\.0\.1/u, 'The in-app search notice exposed source details')
}
const searchCompletionFallbackAccessibility = await session.eval(`(() => {
  const region = document.querySelector('.visually-hidden[role="status"][aria-live="polite"][aria-atomic="true"]')
  const visualToast = document.querySelector('.toast-message')
  return {
    role: region?.getAttribute('role') ?? null,
    ariaLive: region?.getAttribute('aria-live') ?? null,
    ariaAtomic: region?.getAttribute('aria-atomic') ?? null,
    announcementText: region?.innerText ?? '',
    visualToastAriaHidden: visualToast?.getAttribute('aria-hidden') ?? null,
  }
})()`)
if (nativeNotification.globalToastEnabled === 0) {
  assert.equal(searchCompletionFallbackAccessibility.role, 'status', 'The search fallback has no persistent status role for screen readers')
  assert.equal(searchCompletionFallbackAccessibility.ariaLive, 'polite', 'The search fallback status region is not polite')
  assert.equal(searchCompletionFallbackAccessibility.ariaAtomic, 'true', 'The search fallback status region is not atomic')
  assert.ok(searchCompletionFallbackAccessibility.announcementText.includes('Falló la consulta de 1 fuente.'), 'The screen-reader status region does not contain the search fallback')
  assert.equal(searchCompletionFallbackAccessibility.visualToastAriaHidden, 'true', 'The visual search toast may duplicate the status-region announcement')
}
await session.eval("Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim().startsWith('Fuentes'))?.click()")
await delay(400)
const sourceCards = await session.eval("Array.from(document.querySelectorAll('.source-recommended')).map(card => card.innerText)")
assert.equal(sourceCards.length, 7)
const smartRecruiters = sourceCards.find((card) => card.includes('SmartRecruiters'))
assert.ok(smartRecruiters)
assert.match(smartRecruiters, /Agregar 5 tableros/u)
const greenhouse = sourceCards.find((card) => card.includes('Greenhouse'))
assert.ok(greenhouse)
assert.match(greenhouse, /27 tableros Greenhouse/u)
assert.match(greenhouse, /Agregar 27 tableros/u)
const ashby = sourceCards.find((card) => card.includes('Ashby'))
assert.ok(ashby)
assert.match(ashby, /18 tableros públicos de Ashby/u)
assert.match(ashby, /Agregar 18 tableros/u)
assert.match(ashby, /Siena AI/u)
const lever = sourceCards.find((card) => card.includes('Lever'))
assert.ok(lever)
assert.match(lever, /Agregar 18 empresas/u)
assert.match(lever, /Appen/u)
assert.match(lever, /Anchorage Digital/u)
await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-contrast', value: 'more' }] })
const forcedColorScreens = []
for (const label of ['Resumen', 'Búsquedas', 'Vacantes', 'Mis CV', 'Fuentes', 'Preferencias']) {
  await session.eval(`Array.from(document.querySelectorAll('button.nav-item')).find(button => button.querySelector('span')?.innerText.trim() === ${JSON.stringify(label)})?.click()`)
  await delay(160)
  const screen = await session.eval(`(() => {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;left:-10000px;color:HighlightText;background:Highlight'
    document.body.append(probe)
    const expected = { highlight: getComputedStyle(probe).backgroundColor, highlightText: getComputedStyle(probe).color }
    probe.remove()
    const selected = document.querySelector('.nav-item.active')
    const style = getComputedStyle(selected)
    return {
      page: document.querySelector('.page-heading h1')?.innerText.trim() ?? '',
      selectedLabel: selected?.querySelector('span')?.innerText.trim() ?? '',
      selectedColor: style.color,
      selectedBackground: style.backgroundColor,
      expected,
      boxShadow: style.boxShadow,
      transitionDuration: style.transitionDuration,
      animationName: style.animationName,
    }
  })()`)
  assert.ok(screen.page, `The ${label} page has no visible heading in forced-colors mode`)
  assert.equal(screen.selectedLabel, label, `The ${label} navigation item is not selected`)
  assert.equal(screen.selectedBackground, screen.expected.highlight, `${label} selected navigation does not use Highlight`)
  assert.equal(screen.selectedColor, screen.expected.highlightText, `${label} selected navigation does not use HighlightText`)
  assert.equal(screen.boxShadow, 'none', `${label} selected navigation retains a shadow`)
  assert.equal(screen.transitionDuration, '0s', `${label} selected navigation retains transitions`)
  assert.equal(screen.animationName, 'none', `${label} selected navigation retains animations`)
  forcedColorScreens.push({ label, ...screen })
}
await session.eval("Array.from(document.querySelectorAll('button.nav-item')).find(button => button.innerText.trim() === 'Resumen')?.click()")
await delay(300)
await session.eval("Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim().startsWith('Crear búsqueda'))?.click()")
await delay(300)
assert.equal(await session.eval("Boolean(document.querySelector('.modal-card'))"), true, 'Profile dialog did not open for the forced-colors check')
const forcedColors = await session.eval(`(() => {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-10000px;color:HighlightText;background:Highlight;border:1px solid Highlight'
  document.body.append(probe)
  const probeStyle = getComputedStyle(probe)
  const expected = { highlight: probeStyle.backgroundColor, highlightText: probeStyle.color }
  probe.style.color = 'ButtonText'
  probe.style.background = 'ButtonFace'
  probe.style.borderColor = 'ButtonText'
  expected.buttonText = probeStyle.color
  expected.buttonFace = probeStyle.backgroundColor
  probe.style.color = 'CanvasText'
  probe.style.background = 'Canvas'
  probe.style.borderColor = 'CanvasText'
  expected.canvasText = probeStyle.color
  expected.canvas = probeStyle.backgroundColor
  probe.remove()
  const selected = document.querySelector('.nav-item.active')
  const primary = document.querySelector('.modal-card .button-dark')
  const backdrop = document.querySelector('.modal-backdrop')
  const modal = document.querySelector('.modal-card')
  const focus = document.querySelector('.modal-card input')
  focus?.focus()
  const focusStyle = focus ? getComputedStyle(focus) : null
  const selectedStyle = getComputedStyle(selected)
  const primaryStyle = getComputedStyle(primary)
  const backdropStyle = getComputedStyle(backdrop)
  const modalStyle = getComputedStyle(modal)
  return {
    media: {
      forcedColors: matchMedia('(forced-colors: active)').matches,
      prefersContrast: matchMedia('(prefers-contrast: more)').matches,
    },
    screens: ${JSON.stringify(forcedColorScreens)},
    expected,
    selected: { color: selectedStyle.color, background: selectedStyle.backgroundColor, boxShadow: selectedStyle.boxShadow, transitionDuration: selectedStyle.transitionDuration, animationName: selectedStyle.animationName },
    primary: { color: primaryStyle.color, background: primaryStyle.backgroundColor, border: primaryStyle.borderTopColor, boxShadow: primaryStyle.boxShadow },
    backdrop: { background: backdropStyle.backgroundColor, filter: backdropStyle.backdropFilter },
    modal: { color: modalStyle.color, background: modalStyle.backgroundColor, border: modalStyle.borderTopColor, boxShadow: modalStyle.boxShadow },
    focus: focusStyle ? { visible: focus.matches(':focus-visible'), outlineStyle: focusStyle.outlineStyle, outlineWidth: focusStyle.outlineWidth, outlineColor: focusStyle.outlineColor } : null,
  }
})()`)
assert.equal(forcedColors.media.forcedColors, true, 'Chromium did not activate forced-colors emulation')
assert.equal(forcedColors.media.prefersContrast, true, 'Chromium did not activate prefers-contrast emulation')
assert.equal(forcedColors.selected.background, forcedColors.expected.highlight, 'Selected navigation does not use the system Highlight color')
assert.equal(forcedColors.selected.color, forcedColors.expected.highlightText, 'Selected navigation does not use the system HighlightText color')
assert.equal(forcedColors.selected.boxShadow, 'none', 'Selected navigation retains a shadow in forced-colors mode')
assert.equal(forcedColors.selected.transitionDuration, '0s', 'Transitions remain enabled in forced-colors mode')
assert.equal(forcedColors.selected.animationName, 'none', 'Animations remain enabled in forced-colors mode')
assert.equal(forcedColors.primary.color, forcedColors.expected.buttonText, 'Primary dialog action does not use ButtonText')
assert.equal(forcedColors.primary.background, forcedColors.expected.buttonFace, 'Primary dialog action does not use ButtonFace')
assert.equal(forcedColors.backdrop.filter, 'none', 'Modal backdrop blur remains active in forced-colors mode')
assert.equal(forcedColors.modal.color, forcedColors.expected.canvasText, 'Dialog text does not use CanvasText')
assert.equal(forcedColors.modal.background, forcedColors.expected.canvas, 'Dialog background does not use Canvas')
assert.equal(forcedColors.modal.boxShadow, 'none', 'Dialog retains a shadow in forced-colors mode')
assert.ok(forcedColors.focus?.visible, 'The focused modal field is not focus-visible')
assert.equal(forcedColors.focus.outlineStyle, 'solid', 'Focus indicator is not a visible outline')
assert.equal(forcedColors.focus.outlineWidth, '2px', 'Focus indicator has an unexpected width')
assert.equal(forcedColors.focus.outlineColor, forcedColors.expected.highlight, 'Focus indicator does not use the system Highlight color')
const screenshot = await session.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const forcedColorsScreenshot = path.join(qaRoot, 'QA-FORCED-COLORS.png')
fs.writeFileSync(forcedColorsScreenshot, Buffer.from(screenshot.data, 'base64'))
const releaseForcedColorsScreenshot = path.join(release, 'QA-FORCED-COLORS.png')
fs.copyFileSync(forcedColorsScreenshot, releaseForcedColorsScreenshot)
await session.eval(`(() => {
  const input = document.querySelector('#profile-locality-search')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!input || !setter) throw new Error('Georef locality search field is missing')
  setter.call(input, 'Carolina, Goya, Corrientes')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await delay(350)
const georefSuggestions = await session.eval("Array.from(document.querySelectorAll('.locality-suggestions button')).map(button => button.getAttribute('aria-label') || '')")
assert.equal(georefSuggestions.length, 2, 'Georef did not return both identical-name localities')
assert.ok(georefSuggestions.some((label) => label.includes('18070010')))
assert.ok(georefSuggestions.some((label) => label.includes('18070011')))
await session.eval("document.querySelector('.locality-suggestions button')?.click()")
const selectedGeorefLocality = await session.eval("document.querySelector('.modal-card textarea[required]')?.value || ''")
assert.match(selectedGeorefLocality, /\[Georef:18070010\]$/u, 'Selecting a locality did not save its exact Georef ID in the profile form')
await session.eval("Array.from(document.querySelectorAll('.modal-card button')).find(button => button.innerText.trim() === 'Cancelar')?.click()")
await delay(250)
assert.equal(await session.eval("Boolean(document.querySelector('.modal-card'))"), false, 'Cancel did not close the profile dialog after the forced-colors check')
await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-contrast', value: 'no-preference' }] })
session.socket.close()

const kill = spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
assert.ok(kill.status === 0 || app.exitCode !== null, kill.stderr)
if (app.exitCode === null) await waitExit(app)

const databasePath = path.join(userDataDir, 'radar-laboral.sqlite')
assert.ok(fs.existsSync(databasePath), 'App did not create its isolated SQLite database')
const database = new Database(databasePath)
const integrity = database.pragma('integrity_check', { simple: true })
const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
const reminderMarker = database.prepare('SELECT follow_up_notified_for_date FROM opportunities WHERE id = ?').get(reminder.id)
assert.equal(integrity, 'ok')
assert.equal(tables.length, 7)
const reminderDeliveryConfirmed = reminderMarker?.follow_up_notified_for_date === today
const inAppFallbackObserved = inAppReminderText.includes('Llegó la fecha para retomar')
if (nativeNotification.globalToastEnabled === 0) {
  assert.equal(inAppFallbackObserved, true, 'Windows has global toast notifications disabled, but the in-app fallback was not displayed')
  assert.equal(reminderDeliveryConfirmed, true, 'The displayed in-app fallback was not acknowledged in SQLite')
  assert.equal(inAppFallbackAccessibility.role, 'status', 'The fallback has no persistent status role for screen readers')
  assert.equal(inAppFallbackAccessibility.ariaLive, 'polite', 'The fallback status region is not polite')
  assert.equal(inAppFallbackAccessibility.ariaAtomic, 'true', 'The fallback status region is not atomic')
  assert.ok(inAppFallbackAccessibility.announcementText.includes('Llegó la fecha para retomar'), 'The screen-reader status region does not contain the fallback text')
  assert.equal(inAppFallbackAccessibility.visualToastAriaHidden, 'true', 'The visual toast may duplicate the status-region announcement')
}
database.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('qa-preserve-sentinel', version)
database.close()
const userDataHash = hash(databasePath)

const uninstaller = path.join(installDir, 'Uninstall Radar Laboral.exe')
assert.ok(fs.existsSync(uninstaller))
const uninstall = spawn(uninstaller, ['/S'], { stdio: 'ignore', windowsHide: true })
assert.equal(await waitExit(uninstall), 0, 'NSIS uninstaller failed')
for (let attempt = 0; attempt < 120 && fs.existsSync(installedExe); attempt++) await delay(250)
assert.ok(!fs.existsSync(installedExe), 'Install directory retained the application executable')
assert.equal(hash(databasePath), userDataHash, 'Uninstaller changed the synthetic SQLite profile')
assert.deepEqual(taskSnapshot(), beforeTask)
assert.equal(notificationShortcut?.appUserModelId, 'ar.radarlaboral.desktop', 'Start Menu shortcut is missing the Radar AppUserModelID')
assert.equal(notificationShortcut?.toastActivatorClsid?.replace(/[{}]/gu, '').toUpperCase(), '017378BE-4BF1-42DA-A318-80EDED2C1A4B', 'Start Menu shortcut is missing the stable toast activator CLSID')

const hashes = { installer: hash(installer), blockmap: hash(`${installer}.blockmap`), executable: hash(executable), appAsar: hash(archive) }
const signatures = { installer: signature(installer), executable: signature(executable) }
const report = {
  version,
  method: 'NSIS x64 installation, isolated synthetic profile, CDP source-card and forced-colors checks, and uninstall',
  installerSha256: hashes.installer,
  package: { asarEntries: entries.length, testsExcluded: true, sprintfJsExcluded: toolchainModulesExcluded.sprintfJs, toolchainModulesExcluded, cspConnectSelfOnly: true, windowsNotificationIdentity: { appUserModelId: notificationShortcut.appUserModelId, toastActivatorClsid: notificationShortcut.toastActivatorClsid, startMenuShortcutVerified: true }, greenhouseCookUnityPolicyIncluded: cookUnityPolicyIncluded, greenhouseDeptPolicyIncluded: deptPolicyIncluded, greenhouseUserinfoGuardIncluded, documentationFiles: documentationFiles.length, markdownDocs: markdownFiles.length - 1, markdownLinksChecked, packagedEvidenceFiles: packagedEvidenceFiles.length, packagedEvidenceBytes, signatures },
  installedApp: {
    title: 'Radar Laboral',
    recommendedSourceCards: sourceCards.length,
    greenhouseButton: 'Agregar 27 tableros',
    ashbyButton: 'Agregar 18 tableros',
    sienaAiListed: ashby.includes('Siena AI'),
    smartRecruitersButton: 'Agregar 5 tableros',
  },
  forcedColors: {
    method: 'Chromium CDP emulation of forced-colors: active and prefers-contrast: more in the installed renderer',
    styles: forcedColors,
    screenshot: path.relative(root, releaseForcedColorsScreenshot),
    note: 'Browser emulation checks renderer system-color rules; it does not replace a visual review with the actual Windows high-contrast setting.',
  },
  georefLocalityPicker: {
    query: 'Carolina, Goya, Corrientes',
    suggestedLocalities: georefSuggestions,
    selectedValue: selectedGeorefLocality,
  },
  sqlite: { integrity, tables: tables.length, syntheticPreferencePreserved: true, syntheticReminderDeliveryConfirmed: reminderDeliveryConfirmed },
  notification: {
    syntheticReminderSeeded: true,
    deliveryConfirmedByApp: reminderDeliveryConfirmed,
    reminderPendingInDatabase: !reminderDeliveryConfirmed,
    nativeToastObserved: nativeNotification.observed,
    nativeToastMatchedNames: nativeNotification.matchedNames,
    inAppFallbackObserved,
    inAppFallbackAccessibility,
    searchCompletion: {
      sourceKind: 'synthetic RSS endpoint blocked before connecting to loopback',
      checkedSources: searchResult.checkedSources,
      added: searchResult.added,
      errors: searchResult.errors.length,
      errorWasPrivateAddressBlock: /p.blica|privada|loopback/u.test(searchResult.errors[0].message),
      inAppFallbackObserved: nativeNotification.globalToastEnabled === 0 ? Boolean(inAppSearchCompletionText) : null,
      inAppFallbackText: inAppSearchCompletionText,
      accessibility: searchCompletionFallbackAccessibility,
    },
    globalToastEnabled: nativeNotification.globalToastEnabled,
    outcome: nativeNotification.observed ? 'native-toast-observed' : inAppFallbackObserved ? 'in-app-fallback-observed' : reminderDeliveryConfirmed ? 'electron-show-event-observed-ui-not-captured' : nativeNotification.globalToastEnabled === 0 ? 'pending-global-toast-disabled' : 'pending-no-show-event',
  },
  uninstallExit: 0,
  syntheticUserDataPreserved: true,
  scheduledTaskUnchanged: true,
  hashes,
  qaDirectory: path.relative(root, qaRoot),
}
const sums = [[hashes.installer, path.basename(installer)], [hashes.blockmap, path.basename(`${installer}.blockmap`)], [hashes.executable, path.relative(release, executable)], [hashes.appAsar, path.relative(release, archive)]]
  .map(([digest, file]) => `${digest}  ${file}`).join('\n')
fs.writeFileSync(path.join(qaRoot, 'QA-PACKAGE.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
fs.writeFileSync(path.join(qaRoot, 'SHA256SUMS.txt'), `${sums}\n`, 'utf8')
fs.writeFileSync(path.join(release, 'QA-PACKAGE.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${sums}\n`, 'utf8')
console.log(JSON.stringify({ version, installerSha256: hashes.installer, asarEntries: entries.length, sourceCards: sourceCards.length, forcedColorScreens: forcedColors.screens.length, markdownLinksChecked, packagedEvidenceFiles: packagedEvidenceFiles.length, packagedEvidenceBytes, sqlite: integrity, uninstallExit: 0, signatures, qaDirectory: report.qaDirectory }, null, 2))
