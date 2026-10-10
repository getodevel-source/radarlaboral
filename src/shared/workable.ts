import type { JsonSourceConfig } from './types'

export const WORKABLE_SUR_URL = 'https://apply.workable.com/api/v1/widget/accounts/surglobal?details=true'
export const WORKABLE_MAX_PUBLIC_JOBS = 250
export const WORKABLE_MAX_ARGENTINA_JOBS = 100

export const workableArgentinaJsonConfig: JsonSourceConfig = {
  itemsPath: '/jobs',
  titlePath: '/title',
  urlPath: '/url',
  descriptionPath: '/description',
  companyPath: '/company',
  locationPath: '/location',
  salaryPath: '',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/publishedAt',
  filterPath: '/country',
  filterValue: 'Argentina',
}

type WorkableJob = {
  title?: unknown
  shortcode?: unknown
  url?: unknown
  country?: unknown
  city?: unknown
  state?: unknown
  description?: unknown
  published_on?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function workableJobUrl(value: unknown, shortcode: string): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' || url.hostname !== 'apply.workable.com' || url.port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== `/j/${shortcode}`
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

function locationText(job: WorkableJob): string {
  const parts = [text(job.city), text(job.state), text(job.country)]
    .filter((part, index, values) => part && values.findIndex((candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
  return parts.join(', ') || 'Argentina'
}

/**
 * The public Workable account endpoint expands one job into country-specific records.
 * Keep only explicit Argentina entries, validate the direct application links, and
 * stop before the generic feed mapper could silently truncate a larger response.
 */
export function workableArgentinaPayload(input: unknown): { jobs: Array<Record<string, unknown>> } {
  if (!isObject(input) || text(input.name).toLocaleLowerCase() !== 'sur' || !Array.isArray(input.jobs)) {
    throw new Error('Workable devolvió una lista de empleos con un formato o una cuenta no reconocidos.')
  }
  const { jobs } = input as { jobs: unknown[] }
  if (jobs.length > WORKABLE_MAX_PUBLIC_JOBS) {
    throw new Error(`Workable devolvió ${jobs.length} registros; esta fuente admite hasta ${WORKABLE_MAX_PUBLIC_JOBS} por consulta.`)
  }

  const argentinaJobs = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < jobs.length; index += 1) {
    const value = jobs[index]
    if (!isObject(value)) throw new Error(`El aviso ${index + 1} de Workable no tiene un formato válido.`)
    const job = value as WorkableJob
    const title = text(job.title)
    const shortcode = text(job.shortcode)
    if (!title || !/^[A-Za-z0-9]+$/u.test(shortcode)) {
      throw new Error(`Workable devolvió un aviso ${index + 1} sin título o código válido.`)
    }
    const url = workableJobUrl(job.url, shortcode)
    if (!url) throw new Error(`Workable devolvió un enlace inválido para el aviso ${shortcode}.`)
    const country = text(job.country)
    if (!country) throw new Error(`Workable no indicó el país del aviso ${shortcode}.`)
    if (country.toLocaleLowerCase() !== 'argentina') continue

    const record = {
      title,
      url,
      description: text(job.description),
      company: 'Sur · empleador final por confirmar',
      location: locationText(job),
      publishedAt: text(job.published_on),
      country: 'Argentina',
    }
    const existing = argentinaJobs.get(shortcode)
    if (existing) {
      const locations = new Set([text(existing.location), text(record.location)].filter(Boolean))
      existing.location = [...locations].join('; ')
    } else {
      argentinaJobs.set(shortcode, record)
    }
  }

  if (argentinaJobs.size > WORKABLE_MAX_ARGENTINA_JOBS) {
    throw new Error(`Workable devolvió más de ${WORKABLE_MAX_ARGENTINA_JOBS} avisos argentinos; no se importaron resultados parciales.`)
  }
  return { jobs: [...argentinaJobs.values()] }
}
