import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const BACKGROUND_TASK_NAME = 'RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch'
const scheduledRunArgument = '--radar-background-run'

type CommandResult = { stdout: string; stderr: string }
type RunCommand = (program: string, args: string[]) => Promise<CommandResult>
type ScheduleDependencies = {
  runCommand?: RunCommand
  userSid?: () => Promise<string>
  tempDirectory?: string
  taskName?: string
  startBoundary?: string
}

const runCommand: RunCommand = async (program, args) => {
  const result = await execFileAsync(program, args, {
    windowsHide: true,
    timeout: 15_000,
    encoding: 'utf8',
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

function systemProgram(name: string) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)
}

async function currentUserSid(run: RunCommand) {
  const { stdout } = await run(systemProgram('whoami.exe'), ['/user', '/fo', 'csv', '/nh'])
  const sid = stdout.match(/\bS-1-\d+(?:-\d+)+\b/u)?.[0]
  if (!sid) throw new Error('Windows no devolvió el identificador de la cuenta actual.')
  return sid
}

function escapeXml(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;')
}

function localDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function quoteWindowsArgument(value: string) {
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

export function createBackgroundTaskXml(
  executablePath: string,
  userSid: string,
  intervalHours: number,
  startBoundary = localDateTime(new Date()),
  userDataPath?: string | null,
) {
  if (![4, 8, 12, 24].includes(intervalHours)) throw new Error('El intervalo de la tarea de Windows no es válido.')
  if (!path.win32.isAbsolute(executablePath) || executablePath.includes('\0')) throw new Error('La ruta de Radar Laboral no es válida para la tarea de Windows.')
  if (!/^S-1-\d+(?:-\d+)+$/u.test(userSid)) throw new Error('El identificador de la cuenta de Windows no es válido.')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(startBoundary)) throw new Error('El inicio de la tarea de Windows no es válido.')
  if (userDataPath && (!path.win32.isAbsolute(userDataPath) || userDataPath.startsWith('\\\\') || userDataPath.includes('\0'))) {
    throw new Error('La carpeta local de datos no es válida para la tarea de Windows.')
  }

  const safeSid = escapeXml(userSid)
  const safeExecutablePath = escapeXml(executablePath)
  const safeWorkingDirectory = escapeXml(path.win32.dirname(executablePath))
  const taskArguments = [scheduledRunArgument]
  if (userDataPath) taskArguments.push(`--radar-user-data-dir=${quoteWindowsArgument(path.win32.resolve(userDataPath))}`)
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Busca vacantes con Radar Laboral en la sesión de la persona actual.</Description>
    <URI>\\RadarLaboral\\BackgroundSearch</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${safeSid}</UserId>
    </LogonTrigger>
    <CalendarTrigger>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
      <Repetition>
        <Interval>PT${intervalHours}H</Interval>
        <Duration>P1D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${safeSid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${safeExecutablePath}</Command>
      <Arguments>${escapeXml(taskArguments.join(' '))}</Arguments>
      <WorkingDirectory>${safeWorkingDirectory}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
}

function isMissingTask(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { stdout?: unknown; stderr?: unknown; message?: unknown }
  const message = `${String(value.stdout ?? '')} ${String(value.stderr ?? '')} ${String(value.message ?? '')}`.toLocaleLowerCase()
  return /cannot find|could not find|not found|no se encuentra|no puede encontrar|no existe/u.test(message)
}

function scheduleError(error: unknown, action: string) {
  const value = error as { stderr?: unknown; message?: unknown }
  const detail = String(value?.stderr || value?.message || '').trim()
  return new Error(detail ? `Windows no pudo ${action} la búsqueda en segundo plano: ${detail}` : `Windows no pudo ${action} la búsqueda en segundo plano.`)
}

export async function syncWindowsBackgroundSchedule(
  enabled: boolean,
  executablePath: string,
  intervalHours: number,
  userDataPath?: string | null,
  dependencies: ScheduleDependencies = {},
) {
  const run = dependencies.runCommand ?? runCommand
  const schtasksPath = systemProgram('schtasks.exe')
  const taskName = dependencies.taskName ?? BACKGROUND_TASK_NAME

  if (!enabled) {
    try {
      await run(schtasksPath, ['/delete', '/tn', taskName, '/f'])
    } catch (error) {
      if (!isMissingTask(error)) throw scheduleError(error, 'desactivar')
    }
    return
  }

  let temporaryDirectory: string | null = null
  try {
    const userSid = await (dependencies.userSid ? dependencies.userSid() : currentUserSid(run))
    const xml = createBackgroundTaskXml(executablePath, userSid, intervalHours, dependencies.startBoundary, userDataPath)
    temporaryDirectory = await mkdtemp(path.join(dependencies.tempDirectory ?? os.tmpdir(), 'radar-laboral-task-'))
    const taskXmlPath = path.join(temporaryDirectory, 'background-search.xml')
    await writeFile(taskXmlPath, `\uFEFF${xml}`, { encoding: 'utf16le', flag: 'wx' })
    await run(schtasksPath, ['/create', '/tn', taskName, '/xml', taskXmlPath, '/f'])
  } catch (error) {
    throw scheduleError(error, 'programar')
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
