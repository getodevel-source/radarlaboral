/**
 * Capturas reales para el README: lanza la app instalada (o win-unpacked),
 * siembra un perfil sintético con avisos de muestra, navega Resumen →
 * Vacantes → Búsquedas y guarda PNG en docs/images/.
 *
 * Uso: `node scripts/capture-readme-shots.mjs [exe] [user-data-dir]`
 * Sin args usa release/<versión>/win-unpacked y .qa-readme-shots/.
 *
 * Los datos son 100% ficticios (empresa/URLs example.org) y el viewport es
 * fijo (1400x900) para capturas consistentes. No toca el smoke.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { RadarDatabase } from '../electron/database.ts'
import { localDateString } from '../src/shared/local-date.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = manifest.version
const unpackedExe = path.join(root, 'release', version, 'win-unpacked', 'Radar Laboral.exe')
const exe = process.argv[2] ? path.resolve(root, process.argv[2]) : unpackedExe
const shotsRoot = process.argv[3]
  ? path.resolve(root, process.argv[3])
  : path.join(root, '.qa-readme-shots')
const userDataDir = path.join(shotsRoot, 'user-data')
const imagesDir = path.join(root, 'docs', 'images')
assert.ok(fs.existsSync(exe), `Build the app first: ${exe}`)
fs.rmSync(shotsRoot, { recursive: true, force: true })
fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(imagesDir, { recursive: true })

// --- Seed: perfil + avisos ficticios, nada real ---
const database = new RadarDatabase(userDataDir)
const profile = database.saveProfile({
  name: 'Atención al cliente',
  searchDescription: 'Trabajo de atención al cliente o administración en Rosario, jornada completa.',
  roles: ['atención al cliente', 'administrativo', 'recepción'],
  locations: ['Rosario, Santa Fe'],
  radiusKm: 25,
  includeKeywords: [],
  excludeKeywords: [],
  workMode: 'indistinto',
  schedule: 'Jornada completa',
  requireScheduleMatch: false,
  requireSalaryMatch: false,
  workDaysPerWeek: null,
  workHoursPerWeek: null,
  minimumSalary: 800000,
  minimumSalaryCurrency: 'ARS',
  convertSalaryCurrencies: false,
  active: true,
})
const samples = [
  {
    title: 'Atención al cliente · turno mañana',
    company: 'Empresa de ejemplo S.A.',
    location: 'Rosario, Santa Fe',
    source: 'Portal de ejemplo',
    url: 'https://example.org/avisos/atencion-cliente-manana',
    description: 'Atención telefónica y por correo a clientes, de lunes a viernes por la mañana.',
    salaryText: '$ 850.000 mensuales',
    status: 'nueva',
  },
  {
    title: 'Recepción y administración',
    company: 'Oficina de muestra',
    location: 'Rosario, Santa Fe',
    source: 'Portal de ejemplo',
    url: 'https://example.org/avisos/recepcion-administracion',
    description: 'Recepción, agenda de turnos y carga de datos en sistema interno.',
    salaryText: '$ 900.000 mensuales',
    status: 'guardada',
  },
  {
    title: 'Soporte a clientes · remoto',
    company: 'Compañía ficticia',
    location: 'Remoto · Argentina',
    source: 'Portal de ejemplo',
    url: 'https://example.org/avisos/soporte-remoto',
    description: 'Soporte por chat para usuarios de Argentina, jornada completa.',
    salaryText: 'USD 700 mensuales',
    status: 'postulada',
  },
]
const today = localDateString()
for (const sample of samples) {
  const saved = database.addOpportunity({ ...sample, profileId: profile.id, matchScore: 82, matchReasons: ['Puesto compatible con el perfil', 'Localidad dentro del radio'], missingRequirements: [] })
  if (sample.status !== 'nueva') database.updateOpportunityStatus(saved.id, sample.status)
  if (sample.status === 'postulada') {
    database.updateOpportunityTracking(saved.id, { appliedDate: today, followUpDate: today, trackingNotes: 'Llamar para consultar estado.' })
  }
}
database.close()

// --- Launch + CDP ---
function cdp(url) {
  const socket = new WebSocket(url)
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(event.data.toString()) } catch { return }
    if (!message.id) {
      if (message.method === 'Runtime.exceptionThrown') console.error('Renderer exception:', message.params.exceptionDetails.text, message.params.exceptionDetails.exception?.description ?? '')
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') console.error('Renderer console error:', message.params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '))
      return
    }
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

async function waitTarget(port, child) {
  const end = Date.now() + 60_000
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
    await delay(300)
  }
  throw new Error('Installed renderer did not appear in CDP')
}

function waitExit(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Process exceeded timeout')), timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

const server = net.createServer()
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
const remotePort = server.address().port
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
const app = spawn(exe, [`--radar-user-data-dir=${userDataDir}`, `--remote-debugging-port=${remotePort}`], { stdio: 'ignore', windowsHide: true })
try {
  const target = await waitTarget(remotePort, app)
  const session = cdp(target.webSocketDebuggerUrl)
  await session.open
  await session.command('Runtime.enable')
  assert.equal(await session.eval('document.title'), 'Radar Laboral')
  await session.command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })

  const shots = []
  const capture = async (navLabel, file) => {
    const clicked = await session.eval(`Array.from(document.querySelectorAll('button.nav-item span')).find((el) => el.textContent.trim() === '${navLabel}')?.closest('button') ? (Array.from(document.querySelectorAll('button.nav-item span')).find((el) => el.textContent.trim() === '${navLabel}').closest('button').click(), true) : false`)
    await delay(800)
    if (!clicked) throw new Error(`Nav item not found: ${navLabel}`)
    if (navLabel === 'Vacantes') {
      await session.eval("Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Todas')?.click()")
      await delay(400)
    }
    await session.eval("if (document.querySelector('.toast-message')) document.querySelector('.toast-message').style.display = 'none'")
    await delay(200)
    const heading = await session.eval("document.querySelector('.page-head h1')?.innerText ?? document.querySelector('h1')?.innerText ?? ''")
    const shot = await session.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const out = path.join(imagesDir, file)
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
    shots.push({ navLabel, file, heading, bytes: fs.statSync(out).size })
    console.log(`${file}: nav=${navLabel} heading=${JSON.stringify(heading)} bytes=${fs.statSync(out).size}`)
  }

  await capture('Resumen', 'resumen.png')
  await capture('Vacantes', 'vacantes.png')
  await capture('Búsquedas', 'busquedas.png')
  await capture('Preferencias', 'preferencias.png')
  assert.ok(await session.eval("Boolean(document.querySelector('.theme-switch'))"), 'Appearance switch is missing from Preferences')
  await session.eval("document.querySelector('.theme-switch')?.click()")
  await delay(350)
  assert.equal(await session.eval("document.documentElement.dataset.theme"), 'dark', 'Appearance switch did not apply the dark theme')
  assert.equal(await session.eval("localStorage.getItem('radar-laboral-theme')"), 'dark', 'Dark theme was not saved for this profile')
  await capture('Preferencias', 'tema-oscuro.png')

  // Sanity: all five captures have real content.
  for (const shot of shots) {
    assert.ok(shot.bytes > 20_000, `Shot too small, page may not have rendered: ${shot.file}`)
  }
  console.log(JSON.stringify({ version, shots: shots.length, imagesDir: path.relative(root, imagesDir) }))
} finally {
  app.kill()
  await waitExit(app).catch(() => {})
}

const reopenedApp = spawn(exe, [`--radar-user-data-dir=${userDataDir}`, `--remote-debugging-port=${remotePort}`], { stdio: 'ignore', windowsHide: true })
try {
  const target = await waitTarget(remotePort, reopenedApp)
  const session = cdp(target.webSocketDebuggerUrl)
  await session.open
  assert.equal(await session.eval("document.documentElement.dataset.theme"), 'dark', 'Dark theme did not persist after restarting the app')
  assert.equal(await session.eval("localStorage.getItem('radar-laboral-theme')"), 'dark', 'Dark theme preference was lost after restarting the app')
  console.log('Appearance theme persisted after a full app restart.')
} finally {
  reopenedApp.kill()
  await waitExit(reopenedApp).catch(() => {})
}
