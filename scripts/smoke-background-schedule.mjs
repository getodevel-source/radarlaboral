import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { RadarDatabase } from '../electron/database.ts'
import { syncWindowsBackgroundSchedule } from '../electron/background-schedule.ts'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = manifest.version
const release = path.join(root, 'release', version)
const executable = path.join(release, 'win-unpacked', 'Radar Laboral.exe')
const runId = `${Date.now()}-${process.pid}`
const taskName = `RadarLaboral-QA-BackgroundSearch-${runId}`
const recurrenceTaskName = `${taskName}-Repeat`
const syntheticRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-laboral-background-qa-'))
const userDataDirectory = path.join(syntheticRoot, 'user-data')
const reportPath = path.join(release, 'QA-BACKGROUND-SCHEDULE.json')
const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const schtasks = path.join(systemRoot, 'System32', 'schtasks.exe')
const taskStartBoundary = localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
const report = {
  version,
  method: 'Temporary per-user Windows Task Scheduler tasks, on-demand launch plus accelerated one-minute recurrence, synthetic profile, main-window visibility probe',
  taskName,
  result: 'failed',
  task: { created: false, startedOnDemand: false, logonTrigger: false, intervalHours: null, logonType: null, xmlLogonType: null, principalMatchesCurrentUser: false, runLevel: null, exportedXmlRunLevel: null, interactiveToken: false, leastPrivilege: false, startWhenAvailable: false },
  recurrence: { taskName: recurrenceTaskName, testIntervalMinutes: 1, startBoundary: null, firstScheduledRunObserved: false, secondScheduledRunObserved: false, runTimesUtc: [] },
  application: { started: false, mainWindowCreated: false, mainWindowVisible: null, syntheticProfile: true },
  cleanup: { taskRemoved: false, recurrenceTaskRemoved: true, applicationStopped: false, syntheticProfileRemoved: false },
  error: null,
}
let taskMayExist = false
let recurrenceTaskMayExist = false
let primaryError = null

function localDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function xmlTagValue(xml, name) {
  return xml.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`, 'u'))?.[1]?.trim() ?? null
}

async function run(program, args, timeout = 20_000) {
  return execFileAsync(program, args, { encoding: 'utf8', timeout, windowsHide: true })
}

async function probeWindow() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class RadarWindowRecord {
  public long Handle { get; set; }
  public uint ProcessId { get; set; }
  public bool Visible { get; set; }
  public string Title { get; set; }
}
public static class RadarWindowProbe {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int capacity);
  public static RadarWindowRecord[] ForProcess(uint targetProcessId) {
    var records = new List<RadarWindowRecord>();
    EnumWindows((hWnd, lParam) => {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId == targetProcessId) {
        var title = new StringBuilder(512);
        GetWindowText(hWnd, title, title.Capacity);
        records.Add(new RadarWindowRecord {
          Handle = hWnd.ToInt64(), ProcessId = processId,
          Visible = IsWindowVisible(hWnd), Title = title.ToString()
        });
      }
      return true;
    }, IntPtr.Zero);
    return records.ToArray();
  }
}
'@
$profileNeedle = ${psQuote(userDataDirectory)}
$end = [DateTime]::UtcNow.AddSeconds(60)
$lastProcesses = @()
$lastWindows = @()
while ([DateTime]::UtcNow -lt $end) {
  $lastProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'Radar Laboral.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileNeedle) })
  foreach ($process in $lastProcesses) {
    $lastWindows = @([RadarWindowProbe]::ForProcess([uint32]$process.ProcessId))
    $radarWindow = @($lastWindows | Where-Object { $_.Title -eq 'Radar Laboral' })
    if ($radarWindow.Count -gt 0) {
      [pscustomobject]@{
        result = 'window-found'
        processFound = $true
        processId = [uint32]$process.ProcessId
        window = $radarWindow[0]
      } | ConvertTo-Json -Compress -Depth 4
      exit 0
    }
  }
  Start-Sleep -Milliseconds 400
}
[pscustomobject]@{
  result = 'timeout'
  processFound = ($lastProcesses.Count -gt 0)
  processIds = @($lastProcesses | ForEach-Object { [uint32]$_.ProcessId })
  windows = $lastWindows
} | ConvertTo-Json -Compress -Depth 4
`
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 70_000)
  return JSON.parse(result.stdout.trim())
}

async function queryTaskSettings() {
  const script = `
$task = Get-ScheduledTask -TaskName ${psQuote(taskName)} -ErrorAction Stop
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskSid = [string]$task.Principal.UserId
if ($taskSid -notmatch '^S-1-') {
  try { $taskSid = ([System.Security.Principal.NTAccount]::new($taskSid)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch {}
}
[pscustomobject]@{
  logonType = [string]$task.Principal.LogonType
  principalMatchesCurrentUser = ($taskSid -eq $currentSid)
  runLevel = [string]$task.Principal.RunLevel
  startWhenAvailable = [bool]$task.Settings.StartWhenAvailable
} | ConvertTo-Json -Compress
`
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15_000)
  return JSON.parse(result.stdout.trim())
}

async function queryTaskLastRun(targetTaskName) {
  const script = `
$info = Get-ScheduledTaskInfo -TaskName ${psQuote(targetTaskName)} -ErrorAction Stop
$lastRun = $info.LastRunTime
[pscustomobject]@{
  lastRunUtc = if ($lastRun -and $lastRun.Year -gt 2000) { $lastRun.ToUniversalTime().ToString('o') } else { $null }
} | ConvertTo-Json -Compress
`
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15_000)
  return JSON.parse(result.stdout.trim())
}

async function waitForTaskRunAfter(previousRunUtc, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await queryTaskLastRun(recurrenceTaskName)
    if (state.lastRunUtc && (!previousRunUtc || Date.parse(state.lastRunUtc) > Date.parse(previousRunUtc))) return state
    await delay(3_000)
  }
  throw new Error(previousRunUtc
    ? 'The accelerated scheduled task did not run a second time within three minutes.'
    : 'The accelerated scheduled task did not run at its first scheduled boundary within three minutes.')
}

async function registerAcceleratedRecurrenceTask() {
  const { stdout: baseXml } = await run(schtasks, ['/query', '/tn', taskName, '/xml'])
  const start = new Date()
  start.setMinutes(start.getMinutes() + 1, 0, 0)
  const startBoundary = localDateTime(start)
  let xml = baseXml.replace(/<StartBoundary>[^<]*<\/StartBoundary>/u, `<StartBoundary>${startBoundary}</StartBoundary>`)
  xml = xml.replace('<Interval>PT4H</Interval>', '<Interval>PT1M</Interval>')
  xml = xml.replace(/<URI>[^<]*<\/URI>/u, String.raw`<URI>\\RadarLaboral\\BackgroundSearch-QA</URI>`)
  assert.match(xml, /<StartBoundary>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}<\/StartBoundary>/u)
  assert.match(xml, /<Interval>PT1M<\/Interval>/u)
  const xmlPath = path.join(syntheticRoot, 'accelerated-background-search.xml')
  await fs.writeFile(xmlPath, `\uFEFF${xml}`, { encoding: 'utf16le', flag: 'wx' })
  report.recurrence.startBoundary = startBoundary
  recurrenceTaskMayExist = true
  await run(schtasks, ['/create', '/tn', recurrenceTaskName, '/xml', xmlPath, '/f'])
  const { stdout: registeredXml } = await run(schtasks, ['/query', '/tn', recurrenceTaskName, '/xml'])
  assert.match(registeredXml, /<Interval>PT1M<\/Interval>/u, 'Windows did not register the accelerated repetition interval')
}

async function stopSyntheticApplication() {
  const script = `
$profileNeedle = ${psQuote(userDataDirectory)}
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Radar Laboral.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileNeedle) })
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
$remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'Radar Laboral.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileNeedle) })
[pscustomobject]@{ stopped = ($remaining.Count -eq 0); remaining = $remaining.Count } | ConvertTo-Json -Compress
`
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15_000)
  return JSON.parse(result.stdout.trim())
}

try {
  assert.equal(process.platform, 'win32', 'This smoke requires Windows Task Scheduler and Win32 windows')
  assert.ok(await fs.stat(executable).then((info) => info.isFile()).catch(() => false), `Build the Windows package first: ${executable}`)
  await fs.mkdir(userDataDirectory, { recursive: true })

  const database = new RadarDatabase(userDataDirectory)
  database.saveSettings({
    searchIntervalHours: 4,
    backgroundSearchEnabled: true,
    aiEnabled: false,
    aiBaseUrl: '',
    aiModel: '',
  })
  database.close()

  taskMayExist = true
  await syncWindowsBackgroundSchedule(true, executable, 4, userDataDirectory, { taskName, startBoundary: taskStartBoundary })
  report.task.created = true

  const { stdout: taskXml } = await run(schtasks, ['/query', '/tn', taskName, '/xml'])
  const actualTask = await queryTaskSettings()
  report.task.logonType = actualTask.logonType
  report.task.xmlLogonType = xmlTagValue(taskXml, 'LogonType')
  report.task.principalMatchesCurrentUser = actualTask.principalMatchesCurrentUser
  report.task.runLevel = actualTask.runLevel
  report.task.exportedXmlRunLevel = xmlTagValue(taskXml, 'RunLevel')
  report.task.interactiveToken = report.task.logonType === 'Interactive' && report.task.xmlLogonType === 'InteractiveToken' && report.task.principalMatchesCurrentUser
  report.task.leastPrivilege = ['Limited', 'LeastPrivilege', 'LUA'].includes(report.task.runLevel)
  report.task.startWhenAvailable = actualTask.startWhenAvailable && xmlTagValue(taskXml, 'StartWhenAvailable') === 'true'
  report.task.logonTrigger = /<LogonTrigger>/u.test(taskXml)
  report.task.intervalHours = /<Interval>PT4H<\/Interval>/u.test(taskXml) ? 4 : null
  assert.ok(report.task.interactiveToken, 'Registered task does not use the logged-in interactive token')
  assert.ok(report.task.leastPrivilege, `Registered task run level is ${report.task.runLevel ?? 'missing'}, not least privilege`)
  assert.ok(report.task.startWhenAvailable, 'Registered task will not catch up after the computer was unavailable')
  assert.ok(report.task.logonTrigger, 'Registered task has no logon trigger')
  assert.equal(report.task.intervalHours, 4, 'Registered task does not repeat every four hours')

  await run(schtasks, ['/run', '/tn', taskName])
  report.task.startedOnDemand = true
  const windowState = await probeWindow()
  assert.equal(windowState.result, 'window-found', 'The scheduled task did not create the Radar main window')
  report.application.started = windowState.processFound
  report.application.mainWindowCreated = true
  report.application.mainWindowVisible = windowState.window.Visible
  assert.equal(windowState.window.Visible, false, 'Radar showed its main window during a background task launch')

  const stopped = await stopSyntheticApplication()
  assert.equal(stopped.stopped, true, 'Could not stop the first synthetic app before recurrence verification')
  await registerAcceleratedRecurrenceTask()
  recurrenceTaskMayExist = true
  await syncWindowsBackgroundSchedule(false, executable, 4, userDataDirectory, { taskName })
  taskMayExist = false

  const firstScheduledRun = await waitForTaskRunAfter(null)
  report.recurrence.firstScheduledRunObserved = true
  report.recurrence.runTimesUtc.push(firstScheduledRun.lastRunUtc)
  const scheduledWindow = await probeWindow()
  assert.equal(scheduledWindow.result, 'window-found', 'The accelerated scheduled task did not launch Radar')
  assert.equal(scheduledWindow.window.Visible, false, 'Radar showed its main window during the accelerated scheduled launch')

  const secondScheduledRun = await waitForTaskRunAfter(firstScheduledRun.lastRunUtc)
  report.recurrence.secondScheduledRunObserved = true
  report.recurrence.runTimesUtc.push(secondScheduledRun.lastRunUtc)
  assert.ok(Date.parse(secondScheduledRun.lastRunUtc) > Date.parse(firstScheduledRun.lastRunUtc), 'Windows did not record a later scheduled repetition')

  report.result = 'passed'
} catch (error) {
  primaryError = error
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  try {
    if (recurrenceTaskMayExist) {
      await syncWindowsBackgroundSchedule(false, executable, 4, userDataDirectory, { taskName: recurrenceTaskName })
      recurrenceTaskMayExist = false
    }
    report.cleanup.recurrenceTaskRemoved = !recurrenceTaskMayExist
  } catch (error) {
    report.cleanup.recurrenceTaskRemoved = false
    report.error ??= `Could not remove accelerated recurrence task: ${error instanceof Error ? error.message : String(error)}`
  }

  try {
    if (taskMayExist) {
      await syncWindowsBackgroundSchedule(false, executable, 4, userDataDirectory, { taskName })
      taskMayExist = false
    }
    report.cleanup.taskRemoved = !taskMayExist
  } catch (error) {
    report.cleanup.taskRemoved = false
    report.error ??= `Could not remove temporary task: ${error instanceof Error ? error.message : String(error)}`
  }

  try {
    const stopped = await stopSyntheticApplication()
    report.cleanup.applicationStopped = stopped.stopped
    assert.equal(stopped.stopped, true, 'The synthetic Radar process remained open after cleanup')
  } catch (error) {
    report.cleanup.applicationStopped = false
    report.error ??= `Could not stop synthetic Radar process: ${error instanceof Error ? error.message : String(error)}`
  }

  try {
    await fs.rm(syntheticRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    report.cleanup.syntheticProfileRemoved = true
  } catch (error) {
    report.cleanup.syntheticProfileRemoved = false
    report.error ??= `Could not remove synthetic profile: ${error instanceof Error ? error.message : String(error)}`
  }

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

if (report.result !== 'passed' || !report.cleanup.taskRemoved || !report.cleanup.recurrenceTaskRemoved || !report.cleanup.applicationStopped || !report.cleanup.syntheticProfileRemoved) {
  if (primaryError) throw primaryError
  throw new Error(report.error || `Background schedule smoke failed; inspect ${reportPath}`)
}

console.log(JSON.stringify({
  version,
  result: report.result,
  task: { created: report.task.created, startedOnDemand: report.task.startedOnDemand },
  recurrence: { firstScheduledRunObserved: report.recurrence.firstScheduledRunObserved, secondScheduledRunObserved: report.recurrence.secondScheduledRunObserved, testIntervalMinutes: report.recurrence.testIntervalMinutes },
  mainWindowVisible: report.application.mainWindowVisible,
  cleanup: report.cleanup,
  report: path.relative(root, reportPath),
}, null, 2))
