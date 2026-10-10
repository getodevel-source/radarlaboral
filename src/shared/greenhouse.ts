import type { JsonSourceConfig } from './types'

export const GREENHOUSE_MAX_JOBS = 350
export const GREENHOUSE_MAX_ARGENTINA_POSTINGS = 100

export type GreenhouseCustomCareerUrlPattern = {
  hostname: string
  pathname: string
  jobIdQueryParam: string
}

export const greenhouseArgentinaJsonConfig: JsonSourceConfig = {
  itemsPath: '/jobs',
  titlePath: '/title',
  urlPath: '/absolute_url',
  descriptionPath: '/content',
  companyPath: '/company',
  locationPath: '/location',
  salaryPath: '',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/updated_at',
  filterPath: '',
  filterValue: '',
}

type GreenhouseJob = {
  id?: unknown
  title?: unknown
  updated_at?: unknown
  absolute_url?: unknown
  content?: unknown
  location?: { name?: unknown }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isArgentinaLocation(value: string): boolean {
  return /\bArgentina\b|\bARG\b|\bBuenos Aires\b|\bC[óo]rdoba\b/iu.test(value)
}

function normalizeLocationLabel(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function isApprovedArgentinaRegion(value: string, approvedRegionLabels: readonly string[]): boolean {
  const normalizedLocation = ` ${normalizeLocationLabel(value)} `
  return approvedRegionLabels.some((label) => {
    const normalizedLabel = normalizeLocationLabel(label)
    return normalizedLabel && normalizedLocation.includes(` ${normalizedLabel} `)
  })
}

function isPublicGreenhousePostingUrl(
  value: unknown,
  boardToken: string,
  jobId: string,
  approvedCustomCareerUrlPatterns: readonly GreenhouseCustomCareerUrlPattern[],
): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    const authorityStart = value.indexOf('://') + 3
    const authority = value.slice(authorityStart).split(/[/?#]/u, 1)[0]
    if (authority.includes('@')) return false
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false
    if (['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'boards.greenhouse.io'].includes(url.hostname)) {
      return url.pathname.toLowerCase() === `/${boardToken.toLowerCase()}/jobs/${jobId}`
    }
    if (url.port) return false
    return approvedCustomCareerUrlPatterns.some((pattern) => url.hostname === pattern.hostname
      && url.pathname === pattern.pathname.replace('{jobId}', jobId)
      && url.searchParams.size === 1
      && url.searchParams.getAll(pattern.jobIdQueryParam).length === 1
      && url.searchParams.get(pattern.jobIdQueryParam) === jobId)
  } catch {
    return false
  }
}

export function greenhouseArgentinaPayload(
  input: unknown,
  boardToken: string,
  company: string,
  approvedArgentinaRegionLabels: readonly string[] = [],
  approvedCustomCareerUrlPatterns: readonly GreenhouseCustomCareerUrlPattern[] = [],
): { jobs: Array<Record<string, unknown>> } {
  if (!isObject(input) || !Array.isArray(input.jobs) || !isObject(input.meta)) {
    throw new Error('Greenhouse devolvió una lista de empleos con un formato no reconocido.')
  }
  const { jobs, meta } = input as { jobs: unknown[]; meta: { total?: unknown } }
  if (!Number.isSafeInteger(meta.total) || meta.total !== jobs.length) {
    throw new Error('Greenhouse devolvió una lista parcial o sin un total verificable; no se importaron avisos.')
  }
  if (jobs.length > GREENHOUSE_MAX_JOBS) {
    throw new Error(`Greenhouse devolvió ${jobs.length} avisos; esta fuente admite hasta ${GREENHOUSE_MAX_JOBS} por consulta.`)
  }

  const argentinaJobs: Array<Record<string, unknown>> = []
  for (let index = 0; index < jobs.length; index += 1) {
    const value = jobs[index]
    if (!isObject(value)) throw new Error(`El aviso ${index + 1} de Greenhouse no tiene un formato válido.`)
    const job = value as GreenhouseJob
    if (typeof job.location?.name !== 'string'
      || (!isArgentinaLocation(job.location.name) && !isApprovedArgentinaRegion(job.location.name, approvedArgentinaRegionLabels))) continue
    const id = typeof job.id === 'string' || typeof job.id === 'number' ? String(job.id) : ''
    if (!/^\d{1,30}$/u.test(id) || typeof job.title !== 'string' || !job.title.trim()) {
      throw new Error(`Greenhouse devolvió un aviso de Argentina sin título o identificador válido (${index + 1}).`)
    }
    if (!isPublicGreenhousePostingUrl(job.absolute_url, boardToken, id, approvedCustomCareerUrlPatterns)) {
      throw new Error(`Greenhouse devolvió un enlace que no pertenece al aviso ${id} del tablero público de ${company}.`)
    }
    argentinaJobs.push({
      title: job.title.trim(),
      absolute_url: job.absolute_url,
      content: typeof job.content === 'string' ? job.content : '',
      company,
      location: job.location.name.trim(),
      updated_at: typeof job.updated_at === 'string' ? job.updated_at : '',
    })
  }

  if (argentinaJobs.length > GREENHOUSE_MAX_ARGENTINA_POSTINGS) {
    throw new Error(`Greenhouse devolvió más de ${GREENHOUSE_MAX_ARGENTINA_POSTINGS} avisos argentinos; no se importaron resultados parciales.`)
  }

  return { jobs: argentinaJobs }
}
