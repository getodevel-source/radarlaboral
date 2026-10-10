import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { RadarDatabase } from './database'
import { generateApplicationMessage } from './ai'
import { searchGeorefLocalities, testConnector } from './search'
import { recognizeOcrImage } from './ocr'
import { validateJsonSourceConfig } from './connectors/json-feed.ts'
import { validateCsvSourceConfig } from './connectors/csv-feed.ts'
import { importLocalCsv } from './csv-import.ts'
import { importLocalJson, previewLocalJsonImport } from './json-import.ts'
import { refreshSalaryExchangeRates } from './exchange-rates.ts'
import { writeExclusiveCopy } from './exclusive-file-write.ts'
import { normalizeOpportunityUrl } from '../src/shared/opportunity-url.ts'
import { urlCarriesSecret } from '../src/shared/source-url-secrets.ts'

import { validateOpportunityTracking } from '../src/shared/opportunity-tracking.ts'
import { SALARY_CURRENCIES } from '../src/shared/types'
import type {
  AppSettingsInput,
  ApplicationDraftInput,
  CandidateProfileInput,
  CsvSourceConfig,
  ExportResumeCopyInput,
  GenerateMessageInput,
  OpportunityInput,
  OpportunityStatus,
  OpportunityTrackingInput,
  ResumeInput,
  SearchProfileInput,
  SourceKind,
  UserSourceInput,
} from '../src/shared/types'

const statuses: OpportunityStatus[] = ['nueva', 'revisada', 'guardada', 'postulada', 'descartada']
const workModes = ['presencial', 'hibrido', 'remoto', 'indistinto'] as const

const requiredString = (value: unknown, label: string, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} es obligatorio.`)
  }
  return value.trim()
}

const optionalString = (value: unknown, max = 5000) => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

const parseMatchScore = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const score = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(score)) throw new Error('El puntaje de coincidencia no es válido.')
  return Math.max(0, Math.min(100, Math.round(score)))
}

const stringList = (value: unknown, label: string) => {
  if (!Array.isArray(value) || value.length > 40 || value.some((item) => typeof item !== 'string' || item.trim().length > 200)) {
    throw new Error(`${label} no tiene un formato válido.`)
  }
  return value.map((item) => (item as string).trim()).filter(Boolean).slice(0, 40)
}

const validateProfile = (input: unknown): SearchProfileInput => {
  if (!input || typeof input !== 'object') throw new Error('El perfil no tiene un formato válido.')
  const value = input as Partial<SearchProfileInput>
  const mode = value.workMode ?? 'indistinto'
  if (!workModes.includes(mode)) throw new Error('La modalidad no es válida.')
  const radiusKm = typeof value.radiusKm === 'number' || typeof value.radiusKm === 'string' ? Number(value.radiusKm) : NaN
  if (!Number.isInteger(radiusKm) || radiusKm < 0 || radiusKm > 1000) {
    throw new Error('El radio debe ser un número entre 0 y 1000 km.')
  }
  const minimumSalary = value.minimumSalary == null ? null : Number(value.minimumSalary)
  if (minimumSalary !== null && (!Number.isFinite(minimumSalary) || minimumSalary < 0)) {
    throw new Error('El sueldo mínimo no es válido.')
  }
  const minimumSalaryCurrency = value.minimumSalaryCurrency ?? 'ARS'
  if (!SALARY_CURRENCIES.includes(minimumSalaryCurrency as typeof SALARY_CURRENCIES[number])) {
    throw new Error('Elegí una moneda válida para el sueldo mínimo.')
  }
  const convertSalaryCurrencies = value.convertSalaryCurrencies ?? false
  const requireScheduleMatch = value.requireScheduleMatch ?? false
  const requireSalaryMatch = value.requireSalaryMatch ?? false
  if (typeof requireScheduleMatch !== 'boolean') throw new Error('El requisito de horario debe estar activado o desactivado.')
  if (typeof requireSalaryMatch !== 'boolean') throw new Error('El requisito de sueldo debe estar activado o desactivado.')
  if (requireSalaryMatch && minimumSalary === null) throw new Error('Configurá un sueldo mínimo para exigir una coincidencia salarial.')
  const workDaysPerWeek = value.workDaysPerWeek == null ? null : Number(value.workDaysPerWeek)
  if (workDaysPerWeek !== null && (!Number.isFinite(workDaysPerWeek) || workDaysPerWeek < 0.5 || workDaysPerWeek > 7 || !Number.isInteger(workDaysPerWeek * 2))) {
    throw new Error('Los días remunerados por semana deben estar entre 0,5 y 7, en incrementos de 0,5.')
  }
  const workHoursPerWeek = value.workHoursPerWeek == null ? null : Number(value.workHoursPerWeek)
  if (workHoursPerWeek !== null && (!Number.isFinite(workHoursPerWeek) || workHoursPerWeek < 0.25 || workHoursPerWeek > 168 || !Number.isInteger(workHoursPerWeek * 4))) {
    throw new Error('Las horas remuneradas por semana deben estar entre 0,25 y 168, en incrementos de 0,25.')
  }
  if (typeof convertSalaryCurrencies !== 'boolean') throw new Error('La conversión de monedas debe estar activada o desactivada.')
  return {
    name: requiredString(value.name, 'El nombre del perfil', 100),
    searchDescription: optionalString(value.searchDescription, 2000),
    roles: stringList(value.roles, 'Los puestos'),
    locations: stringList(value.locations, 'Las ubicaciones'),
    radiusKm,
    includeKeywords: stringList(value.includeKeywords, 'Las palabras incluidas'),
    excludeKeywords: stringList(value.excludeKeywords, 'Las palabras excluidas'),
    workMode: mode,
    schedule: optionalString(value.schedule, 200),
    requireScheduleMatch,
    requireSalaryMatch,
    workDaysPerWeek,
    workHoursPerWeek,
    minimumSalary,
    minimumSalaryCurrency,
    convertSalaryCurrencies,
    active: Boolean(value.active),
  }
}

const validateCandidateProfile = (input: unknown): CandidateProfileInput => {
  if (!input || typeof input !== 'object') throw new Error('Los datos personales no tienen un formato válido.')
  const value = input as Partial<CandidateProfileInput>
  const profile: CandidateProfileInput = {
    fullName: optionalString(value.fullName, 160),
    email: optionalString(value.email, 250),
    phone: optionalString(value.phone, 80),
    location: optionalString(value.location, 160),
    availability: optionalString(value.availability, 300),
    mobility: optionalString(value.mobility, 300),
    summary: optionalString(value.summary, 2000),
    additionalFacts: optionalString(value.additionalFacts, 2000),
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    throw new Error('Revisá el formato del correo electrónico.')
  }
  return profile
}

const validateOpportunity = (input: unknown): OpportunityInput => {
  if (!input || typeof input !== 'object') throw new Error('La vacante no tiene un formato válido.')
  const value = input as Partial<OpportunityInput>
  let url: string
  try {
    url = normalizeOpportunityUrl(requiredString(value.url, 'El enlace', 2000))
  } catch {
    throw new Error('Ingresá un enlace HTTP o HTTPS válido, sin credenciales.')
  }
  return {
    profileId: typeof value.profileId === 'string' && value.profileId ? value.profileId : null,
    title: requiredString(value.title, 'El puesto', 200),
    company: requiredString(value.company, 'La empresa', 200),
    location: optionalString(value.location, 200),
    source: optionalString(value.source, 120) || new URL(url).hostname.replace(/^www\./, ''),
    url,
    description: optionalString(value.description, 12000),
    salaryText: optionalString(value.salaryText, 300),
    matchScore: parseMatchScore(value.matchScore),
    matchReasons: Array.isArray(value.matchReasons) ? stringList(value.matchReasons, 'Los motivos de coincidencia') : [],
    missingRequirements: Array.isArray(value.missingRequirements) ? stringList(value.missingRequirements, 'Los requisitos faltantes') : [],
    publishedAt: typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt))
      ? new Date(value.publishedAt).toISOString()
      : null,
  }
}

const validateResume = (input: unknown): ResumeInput => {
  if (!input || typeof input !== 'object') throw new Error('El archivo no tiene un formato válido.')
  const value = input as Partial<ResumeInput>
  if (!(value.bytes instanceof Uint8Array)) throw new Error('No se recibió el contenido del PDF.')
  const pageCount = Number(value.pageCount)
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100) {
    throw new Error('El PDF debe tener entre 1 y 100 páginas.')
  }
  return {
    name: requiredString(value.name, 'El nombre del CV', 100),
    originalName: requiredString(value.originalName, 'El archivo', 250),
    pageCount,
    extractedText: optionalString(value.extractedText, 500_000),
    bytes: value.bytes,
  }
}

const validateSettings = (input: unknown): AppSettingsInput => {
  if (!input || typeof input !== 'object') throw new Error('La configuración no tiene un formato válido.')
  const value = input as Partial<AppSettingsInput>
  const interval = Number(value.searchIntervalHours)
  if (![4, 8, 12, 24].includes(interval)) throw new Error('Elegí un intervalo válido para la búsqueda.')
  const aiEnabled = Boolean(value.aiEnabled)
  const aiBaseUrl = optionalString(value.aiBaseUrl, 1000).replace(/\/+$/, '')
  const aiModel = optionalString(value.aiModel, 200)
  if (aiEnabled && (!aiBaseUrl || !aiModel)) throw new Error('Completá la dirección y el modelo del proveedor de IA.')
  if (aiBaseUrl) {
    let url: URL
    try {
      url = new URL(aiBaseUrl)
    } catch {
      throw new Error('La dirección del proveedor no es válida.')
    }
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) || url.username || url.password) {
      throw new Error('Usá HTTPS para proveedores externos. HTTP solo se permite para un servidor local.')
    }
    if (url.search || url.hash) throw new Error('La dirección del proveedor no puede incluir parámetros ni fragmentos.')
  }
  const aiApiKey = optionalString(value.aiApiKey, 2000)
  return {
    searchIntervalHours: interval,
    backgroundSearchEnabled: Boolean(value.backgroundSearchEnabled),
    aiEnabled,
    aiBaseUrl,
    aiModel,
    aiApiKey,
  }
}

const validateGenerateMessage = (input: unknown): GenerateMessageInput => {
  if (!input || typeof input !== 'object') throw new Error('Faltan datos para preparar el mensaje.')
  const value = input as Partial<GenerateMessageInput>
  return {
    opportunityId: assertId(value.opportunityId),
    resumeId: typeof value.resumeId === 'string' && value.resumeId ? assertId(value.resumeId) : null,
  }
}

const validateResumeCopy = (input: unknown): ExportResumeCopyInput => {
  if (!input || typeof input !== 'object') throw new Error('Faltan datos para crear la copia del CV.')
  const value = input as Partial<ExportResumeCopyInput>
  if (typeof value.content !== 'string' || value.content.length > 500_000) throw new Error('El contenido del CV no es válido.')
  return {
    resumeId: assertId(value.resumeId),
    jobTitle: requiredString(value.jobTitle, 'El puesto', 200),
    company: requiredString(value.company, 'La empresa', 200),
    content: value.content,
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!))

const safeFilePart = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 64) || 'Postulacion'


function resumeHtml(input: ExportResumeCopyInput, resumeName: string, candidate: ReturnType<RadarDatabase['candidateProfile']>) {
  const paragraphs = escapeHtml(input.content).split(/\r?\n/).map((line) => line || '&nbsp;').join('\n')
  const contactLine = [candidate.fullName, candidate.email, candidate.phone, candidate.location]
    .filter(Boolean).map(escapeHtml).join(' · ')
  const confirmedFacts = [
    candidate.summary,
    candidate.availability && `Disponibilidad: ${candidate.availability}`,
    candidate.mobility && `Movilidad: ${candidate.mobility}`,
    candidate.additionalFacts,
  ].filter(Boolean).map(escapeHtml).join('<br>')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>CV</title><style>
    @page { size: A4; margin: 18mm 19mm 20mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #26352d; font: 10.5pt/1.48 Arial, sans-serif; }
    header { margin: 0 0 18pt; padding: 0 0 11pt; border-bottom: 2pt solid #506c58; }
    .eyebrow { color: #75836f; font-size: 8pt; font-weight: 700; letter-spacing: 1.3pt; text-transform: uppercase; }
    h1 { margin: 5pt 0 5pt; font-size: 20pt; font-weight: 600; }
    .job { color: #52675a; font-size: 10pt; }
    .contact { margin-top: 7pt; color: #5f6d61; font-size: 8.5pt; }
    .facts { margin-top: 8pt; color: #455a4b; font-size: 9pt; }
    .cv-name { margin: 0 0 9pt; color: #52675a; font-size: 8pt; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 10pt/1.48 Arial, sans-serif; }
    footer { position: fixed; right: 0; bottom: 0; left: 0; padding-top: 8pt; border-top: 0.5pt solid #d8ddd7; color: #92988e; font-size: 7.5pt; }
  </style></head><body><header><div class="eyebrow">Copia para revisar antes de enviar</div><h1>${escapeHtml(input.jobTitle)}</h1><div class="job">${escapeHtml(input.company)}</div>${contactLine ? `<div class="contact">${contactLine}</div>` : ''}${confirmedFacts ? `<div class="facts">${confirmedFacts}</div>` : ''}</header><div class="cv-name">Contenido tomado de: ${escapeHtml(resumeName)}</div><pre>${paragraphs}</pre><footer>Radar Laboral · copia de trabajo · revisá el contenido antes de postularte</footer></body></html>`
}

const validateSource = (input: unknown): UserSourceInput => {
  if (!input || typeof input !== 'object') throw new Error('La fuente no tiene un formato válido.')
  const value = input as Partial<UserSourceInput>
  const kind: SourceKind = value.kind === 'rss' || value.kind === 'json' || value.kind === 'csv' ? value.kind : 'website'
  let url: URL
  try {
    url = new URL(requiredString(value.url, 'El enlace', 2000))
  } catch {
    throw new Error('Ingresá un enlace válido.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('La fuente debe ser un enlace web.')
  if (url.username || url.password) throw new Error('El enlace no puede incluir credenciales.')
  if ((kind === 'rss' || kind === 'json' || kind === 'csv') && url.protocol !== 'https:') throw new Error('Las fuentes automáticas deben usar HTTPS.')
  if ((kind === 'rss' || kind === 'json' || kind === 'csv') && urlCarriesSecret(url)) {
    throw new Error('Las fuentes automáticas deben ser públicas y no incluir claves o credenciales en el enlace.')
  }
  if (kind === 'website' && urlCarriesSecret(url)) {
    throw new Error('El enlace de la fuente no puede incluir claves o credenciales en los parámetros.')
  }
  const customAutomationApproved = value.customAutomationApproved ?? false
  if (typeof customAutomationApproved !== 'boolean') throw new Error('La autorización para consultar una fuente personalizada debe estar activada o desactivada.')
  let automationEvidenceUrl = ''
  if (typeof value.automationEvidenceUrl === 'string' && value.automationEvidenceUrl.trim()) {
    try {
      const evidence = new URL(requiredString(value.automationEvidenceUrl, 'La referencia oficial', 2000))
      if (evidence.protocol !== 'https:' || evidence.username || evidence.password) throw new Error()
      automationEvidenceUrl = evidence.toString()
    } catch {
      throw new Error('La referencia opcional debe ser un enlace HTTPS sin credenciales.')
    }
  } else if (value.automationEvidenceUrl !== undefined && typeof value.automationEvidenceUrl !== 'string') {
    throw new Error('La referencia opcional no tiene un formato válido.')
  }
  return {
    name: requiredString(value.name, 'El nombre de la fuente', 100),
    url: url.toString(),
    kind,
    profileId: typeof value.profileId === 'string' && value.profileId ? value.profileId : null,
    enabled: value.enabled !== false,
    customAutomationApproved,
    automationEvidenceUrl,
    jsonConfig: kind === 'json' ? validateJsonSourceConfig(value.jsonConfig) : null,
    csvConfig: kind === 'csv' ? validateCsvSourceConfig(value.csvConfig as CsvSourceConfig) : null,
  }
}

const validateDraft = (input: unknown): ApplicationDraftInput => {
  if (!input || typeof input !== 'object') throw new Error('El borrador no tiene un formato válido.')
  const value = input as Partial<ApplicationDraftInput>
  return {
    id: typeof value.id === 'string' && value.id ? assertId(value.id) : undefined,
    opportunityId: assertId(value.opportunityId),
    resumeId: typeof value.resumeId === 'string' && value.resumeId ? assertId(value.resumeId) : null,
    message: optionalString(value.message, 10000),
    resumeCopyText: optionalString(value.resumeCopyText, 500_000),
  }
}

const assertId = (value: unknown) => requiredString(value, 'El identificador', 80)

export function registerIpc(
  database: RadarDatabase,
  onSettingsChanged: () => void = () => {},
  search: () => Promise<import('../src/shared/types').SearchRunResult>,
  onRestoreStarted: () => Promise<void> = async () => {},
  onRestoreFailed: () => void = () => {},
  testPdfExportDirectory: string | null = null,
  onBackgroundScheduleChanged: (enabled: boolean, intervalHours: number) => Promise<void> = async () => {},
) {
  ipcMain.handle('geography:search-localities', (_event, rawQuery: unknown) => {
    if (typeof rawQuery !== 'string' || rawQuery.length > 120) return []
    return searchGeorefLocalities(rawQuery).slice(0, 12)
  })
  ipcMain.handle('profiles:list', () => database.listProfiles())
  ipcMain.handle('profiles:save', (_event, payload: unknown) => {
    const value = payload as { id?: unknown; profile?: unknown }
    let nested: unknown
    if (value?.profile && typeof value.profile === 'object' && 'id' in value.profile) {
      nested = value.profile.id
    }
    const rawId = value?.id ?? nested
    const id = rawId === undefined || rawId === null || rawId === '' ? undefined : assertId(rawId)
    return database.saveProfile(validateProfile(value?.profile), id)
  })
  ipcMain.handle('profiles:remove', (_event, id: unknown) => database.removeProfile(assertId(id)))
  ipcMain.handle('candidate:get', () => database.candidateProfile())
  ipcMain.handle('candidate:save', (_event, input: unknown) => database.saveCandidateProfile(validateCandidateProfile(input)))

  ipcMain.handle('opportunities:list', () => database.listOpportunities())
  ipcMain.handle('opportunities:add', (_event, input: unknown) => database.addOpportunity(validateOpportunity(input)))
  ipcMain.handle('opportunities:import-csv', (_event, input: unknown) => importLocalCsv(input, database))
  ipcMain.handle('opportunities:preview-json', (_event, input: unknown) => previewLocalJsonImport(input, database))
  ipcMain.handle('opportunities:import-json', (_event, input: unknown) => importLocalJson(input, database))
  ipcMain.handle('opportunities:update-status', (_event, payload: unknown) => {
    const value = payload as { id?: unknown; status?: unknown }
    if (!statuses.includes(value?.status as OpportunityStatus)) throw new Error('El estado no es válido.')
    const opportunity = database.updateOpportunityStatus(assertId(value?.id), value.status as OpportunityStatus)
    if (!opportunity) throw new Error('No se encontró la vacante.')
    return opportunity
  })
  ipcMain.handle('opportunities:update-tracking', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('El seguimiento no tiene un formato válido.')
    const value = payload as { id?: unknown; tracking?: unknown }
    const tracking: OpportunityTrackingInput = validateOpportunityTracking(value.tracking)
    const opportunity = database.updateOpportunityTracking(assertId(value.id), tracking)
    if (!opportunity) throw new Error('No se encontró la vacante.')
    return opportunity
  })
  ipcMain.handle('opportunities:remove', (_event, id: unknown) => database.removeOpportunity(assertId(id)))

  ipcMain.handle('resumes:list', () => database.listResumes())
  ipcMain.handle('resumes:ocr-page', (_event, image: unknown) => recognizeOcrImage(image))
  ipcMain.handle('resumes:add', (_event, input: unknown) => database.addResume(validateResume(input)))
  ipcMain.handle('resumes:remove', (_event, id: unknown) => database.removeResume(assertId(id)))
  ipcMain.handle('resumes:export-copy', async (event, payload: unknown) => {
    const input = validateResumeCopy(payload)
    const resume = database.getResume(input.resumeId)
    if (!resume) throw new Error('No se encontró el CV elegido.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const filename = `${safeFilePart(resume.name)} - ${safeFilePart(input.company)} - ${safeFilePart(input.jobTitle)}.pdf`
    const saveOptions = {
      title: 'Guardar copia del CV',
      defaultPath: filename,
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    }
    let filePath: string | undefined
    if (testPdfExportDirectory) {
      const expectedDirectory = path.join(path.resolve(app.getPath('userData')), 'test-exports')
      if (path.resolve(testPdfExportDirectory) !== expectedDirectory) {
        throw new Error('La exportación de prueba solo puede guardarse dentro de los datos temporales de la app.')
      }
      await fs.mkdir(testPdfExportDirectory, { recursive: true })
      const directoryStats = await fs.lstat(testPdfExportDirectory)
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        throw new Error('La carpeta temporal de exportación no es segura.')
      }
      filePath = path.join(testPdfExportDirectory, `${safeFilePart(path.parse(filename).name)} - QA-${randomUUID()}.pdf`)
    } else {
      const result = owner
        ? await dialog.showSaveDialog(owner, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (result.canceled || !result.filePath) return null
      filePath = result.filePath
    }
    const outputPath = filePath.toLowerCase().endsWith('.pdf') ? filePath : `${filePath}.pdf`
    const originalPath = path.join(app.getPath('userData'), 'resumes', `${resume.id}.pdf`)
    const outputResolved = path.resolve(outputPath)
    const originalResolved = path.resolve(originalPath)
    const outputParent = path.dirname(outputResolved)
    const outputParentStats = await fs.lstat(outputParent).catch(() => {
      throw new Error('La carpeta de destino no es válida o no existe. Elegí otra ubicación.')
    })
    if (!outputParentStats.isDirectory() || outputParentStats.isSymbolicLink()) {
      throw new Error('La carpeta de destino no es segura. Elegí otra ubicación.')
    }
    try {
      await fs.lstat(outputResolved)
      throw new Error('Ya existe un archivo en esa ubicación. Elegí otro nombre; Radar Laboral no reemplaza archivos existentes.')
    } catch (error) {
      if (error instanceof Error && /Ya existe un archivo en esa ubicación/u.test(error.message)) throw error
      const errno = (error as { code?: unknown } | null | undefined)?.code
      if (errno !== undefined && errno !== 'ENOENT') {
        throw new Error('No se pudo verificar el destino de la copia. Elegí otra ubicación.')
      }
    }
    let outputReal = outputResolved
    try {
      outputReal = await fs.realpath(outputResolved)
    } catch {
      try {
        outputReal = path.join(await fs.realpath(outputParent), path.basename(outputResolved))
      } catch {
        throw new Error('La carpeta de destino no es válida o no existe. Elegí otra ubicación.')
      }
    }
    let originalReal = originalResolved
    try {
      originalReal = await fs.realpath(originalResolved)
    } catch {
      originalReal = originalResolved
    }
    const sameFile = process.platform === 'win32'
      ? outputReal.toLowerCase() === originalReal.toLowerCase()
      : outputReal === originalReal
    if (sameFile || outputResolved === originalResolved) {
      throw new Error('La copia del CV debe guardarse con un nombre distinto del archivo original.')
    }
    const tempParent = path.resolve(app.getPath('temp'))
    let tempDirectory = ''
    let printWindow: BrowserWindow | null = null
    try {
      tempDirectory = await fs.mkdtemp(path.join(tempParent, 'radar-laboral-cv-'))
      if (path.dirname(path.resolve(tempDirectory)) !== tempParent) throw new Error('No se pudo preparar el archivo temporal.')
      const htmlPath = path.join(tempDirectory, 'resume.html')
      await fs.writeFile(htmlPath, resumeHtml(input, resume.name, database.candidateProfile()), { flag: 'wx' })
      printWindow = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
      })
      await printWindow.loadFile(htmlPath)
      const bytes = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.72, bottom: 0.72, left: 0.76, right: 0.76 },
      })
      await writeExclusiveCopy(outputPath, bytes)
      return outputPath
    } finally {
      printWindow?.destroy()
      if (tempDirectory && path.dirname(path.resolve(tempDirectory)) === tempParent && path.basename(tempDirectory).startsWith('radar-laboral-cv-')) {
        await fs.rm(tempDirectory, { recursive: true, force: true })
      }
    }
  })

  ipcMain.handle('sources:list', () => database.listSources())
  ipcMain.handle('sources:add', (_event, input: unknown) => database.addSource(validateSource(input)))
  ipcMain.handle('sources:test-rss', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('La prueba RSS no tiene un formato válido.')
    const value = payload as { url?: unknown }
    const input = validateSource({ ...value, name: 'Prueba de fuente', kind: 'rss', enabled: false })
    return testConnector('rss', input.url)
  })
  ipcMain.handle('sources:test-json', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('La prueba JSON no tiene un formato válido.')
    const value = payload as { url?: unknown; config?: unknown }
    const input = validateSource({
      name: 'Prueba de fuente',
      url: value.url,
      kind: 'json',
      enabled: false,
      jsonConfig: value.config,
      csvConfig: null,
    })
    const config = validateJsonSourceConfig(value.config)
    return testConnector('json', input.url, config)
  })
  ipcMain.handle('sources:test-csv', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('La prueba CSV no tiene un formato válido.')
    const value = payload as { url?: unknown; config?: unknown }
    const input = validateSource({
      name: 'Prueba de fuente',
      url: value.url,
      kind: 'csv',
      enabled: false,
      jsonConfig: null,
      csvConfig: value.config,
    })
    return testConnector('csv', input.url, validateCsvSourceConfig(value.config))
  })
  ipcMain.handle('sources:update-enabled', (_event, payload: unknown) => {
    const value = payload as { id?: unknown; enabled?: unknown }
    const source = database.updateSourceEnabled(assertId(value?.id), Boolean(value?.enabled))
    if (!source) throw new Error('No se encontró la fuente.')
    return source
  })
  ipcMain.handle('sources:update-custom-automation', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('La autorización no tiene un formato válido.')
    const value = payload as { id?: unknown; approved?: unknown }
    if (typeof value.approved !== 'boolean') throw new Error('La autorización debe estar activada o desactivada.')
    const source = database.updateCustomAutomationApproval(assertId(value.id), value.approved)
    if (!source) throw new Error('No se encontró la fuente.')
    return source
  })
  ipcMain.handle('sources:remove', (_event, id: unknown) => database.removeSource(assertId(id)))

  ipcMain.handle('drafts:list', () => database.listDrafts())
  ipcMain.handle('drafts:save', (_event, input: unknown) => database.saveDraft(validateDraft(input)))
  ipcMain.handle('drafts:remove', (_event, id: unknown) => database.removeDraft(assertId(id)))

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:summary', () => database.summary())
  ipcMain.handle('app:settings', () => database.settings())
  ipcMain.handle('app:refresh-salary-exchange-rates', async () => {
    await refreshSalaryExchangeRates(database)
    return database.settings()
  })
  ipcMain.handle('app:run-search', () => search())
  ipcMain.handle('app:create-backup', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Elegir dónde guardar la copia de seguridad',
      buttonLabel: 'Guardar copia aquí',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const { canceled, filePaths } = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (canceled || !filePaths[0]) return null
    return database.createBackup(filePaths[0], app.getVersion())
  })
  ipcMain.handle('app:restore-backup', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Elegir una carpeta de copia de Radar Laboral',
      buttonLabel: 'Revisar copia',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    }
    const { canceled, filePaths } = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (canceled || !filePaths[0]) return null
    await onRestoreStarted()
    try {
      await database.restoreBackup(filePaths[0])
    } catch (error) {
      onRestoreFailed()
      throw error
    }
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 500)
    return true
  })
  ipcMain.handle('app:save-settings', async (_event, payload: unknown) => {
    const input = validateSettings(payload)
    let encryptedAiApiKey: string | null = null
    if (input.aiApiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no habilitó el almacenamiento cifrado para la clave.')
      encryptedAiApiKey = safeStorage.encryptString(input.aiApiKey).toString('base64')
    }

    const previous = database.settings()
    const scheduleChanged = input.backgroundSearchEnabled !== previous.backgroundSearchEnabled
      || input.searchIntervalHours !== previous.searchIntervalHours
    if (scheduleChanged) await onBackgroundScheduleChanged(input.backgroundSearchEnabled, input.searchIntervalHours)
    let settings
    try {
      settings = database.saveSettings(input, input.aiApiKey ? encryptedAiApiKey : undefined)
    } catch (error) {
      if (scheduleChanged) {
        const rollbackError = await onBackgroundScheduleChanged(previous.backgroundSearchEnabled, previous.searchIntervalHours).then((): null => null, (cause: unknown): unknown => cause)
        if (rollbackError !== null && rollbackError !== undefined) {
          console.error('No se pudo revertir la búsqueda programada de Windows:', rollbackError)
          const detail = error instanceof Error ? error.message : 'No se pudo guardar la configuración.'
          throw new Error(`${detail} Además, no se pudo revertir la búsqueda programada; revisá la opción en Preferencias.`)
        }
      }
      throw error
    }
    onSettingsChanged()
    return settings
  })
  ipcMain.handle('app:clear-ai-key', () => {
    database.saveAiApiKeyEncrypted(null)
    return database.settings()
  })
  ipcMain.handle('app:generate-message', async (_event, payload: unknown) => {
    const input = validateGenerateMessage(payload)
    const opportunity = database.getOpportunity(input.opportunityId)
    if (!opportunity) throw new Error('No se encontró la vacante.')
    const resume = input.resumeId ? database.getResume(input.resumeId) : null
    if (input.resumeId && !resume) throw new Error('No se encontró el CV elegido.')
    const settings = database.settings()
    const encryptedKey = database.aiApiKeyEncrypted()
    let apiKey: string | null = null
    if (encryptedKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('No se pudo desbloquear la clave guardada en esta computadora.')
      try {
        apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
      } catch {
        throw new Error('La clave guardada está dañada. Volvé a configurarla en Preferencias o eliminala.')
      }
    }
    return generateApplicationMessage(settings, apiKey, opportunity, resume?.extractedText ?? '', database.candidateProfile())
  })
  ipcMain.handle('app:open-external', async (_event, rawUrl: unknown) => {
    let url: URL
    try {
      url = new URL(requiredString(rawUrl, 'El enlace', 2000))
    } catch {
      throw new Error('El enlace no es válido.')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Solo se pueden abrir enlaces web.')
    if (url.username || url.password || urlCarriesSecret(url)) throw new Error('El enlace no puede incluir credenciales o claves.')
    await shell.openExternal(url.toString())
  })
}
