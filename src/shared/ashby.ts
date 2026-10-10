import type { JsonSourceConfig } from './types'

export const ASHBY_MAX_JOBS = 250
export const ASHBY_MAX_ARGENTINA_POSTINGS = 100

export const ashbyArgentinaJsonConfig: JsonSourceConfig = {
  itemsPath: '/jobs',
  titlePath: '/title',
  urlPath: '/jobUrl',
  descriptionPath: '/description',
  companyPath: '/company',
  locationPath: '/location',
  salaryPath: '',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/publishedAt',
  filterPath: '',
  filterValue: '',
}

type AshbyAddress = {
  addressCountry?: unknown
  addressRegion?: unknown
  addressLocality?: unknown
}

type AshbyPosting = {
  isListed?: unknown
  title?: unknown
  location?: unknown
  address?: unknown
  secondaryLocations?: unknown
  jobUrl?: unknown
  descriptionPlain?: unknown
  descriptionHtml?: unknown
  publishedAt?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function addressRecord(value: unknown): AshbyAddress {
  if (!isObject(value)) return {}
  const postalAddress = isObject(value.postalAddress) ? value.postalAddress : value
  return postalAddress as AshbyAddress
}

function isArgentinaCountry(country: string): boolean {
  return ['argentina', 'arg', 'ar'].includes(country.trim().toLocaleLowerCase())
}

function isArgentinaLocation(location: string, country: string): boolean {
  if (country.trim()) return isArgentinaCountry(country)
  return /\bArgentina\b|\bBuenos Aires\b|\bC[óo]rdoba\b/iu.test(location)
}

function locationText(label: string, address: AshbyAddress): string {
  const locality = text(address.addressLocality)
  const region = text(address.addressRegion)
  const country = text(address.addressCountry)
  if (locality || region || country) {
    const parts = [locality, region, country]
      .filter((part, index, values) => part && values.findIndex((candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
    if (parts.length) return parts.join(', ')
  }
  return label
}

function postingIdFromUrl(value: unknown, boardToken: string): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'jobs.ashbyhq.com' || url.username || url.password) return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || segments[0].toLocaleLowerCase() !== boardToken.toLocaleLowerCase()) return null
    const id = segments[1]
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) return null
    return id
  } catch {
    return null
  }
}

export function ashbyArgentinaPayload(input: unknown, boardToken: string, company: string): { jobs: Array<Record<string, unknown>> } {
  if (!isObject(input) || input.apiVersion !== '1' || !Array.isArray(input.jobs)) {
    throw new Error('Ashby devolvió una lista de empleos con un formato no reconocido.')
  }
  const { jobs } = input as { jobs: unknown[] }
  if (jobs.length > ASHBY_MAX_JOBS) {
    throw new Error(`Ashby devolvió ${jobs.length} avisos; esta fuente admite hasta ${ASHBY_MAX_JOBS} por consulta.`)
  }

  const argentinaJobs: Array<Record<string, unknown>> = []
  for (let index = 0; index < jobs.length; index += 1) {
    const value = jobs[index]
    if (!isObject(value)) throw new Error(`El aviso ${index + 1} de Ashby no tiene un formato válido.`)
    const job = value as AshbyPosting
    if (typeof job.isListed !== 'boolean') {
      throw new Error(`Ashby no indicó si el aviso ${index + 1} está habilitado para mostrarse públicamente.`)
    }
    if (!job.isListed) continue
    if (!Array.isArray(job.secondaryLocations) && job.secondaryLocations !== undefined && job.secondaryLocations !== null) {
      throw new Error(`Ashby devolvió ubicaciones secundarias inválidas para el aviso ${index + 1}.`)
    }

    const rawLocations: Array<{ label: string; address: AshbyAddress }> = [{
      label: text(job.location),
      address: addressRecord(job.address),
    }]
    for (const secondary of job.secondaryLocations ?? []) {
      if (!isObject(secondary)) throw new Error(`Ashby devolvió una ubicación secundaria inválida para el aviso ${index + 1}.`)
      rawLocations.push({
        label: text(secondary.location),
        address: addressRecord(secondary.address),
      })
    }
    const locations = rawLocations
      .map(({ label, address }) => ({
        label: locationText(label, address),
        isArgentina: isArgentinaLocation(label, text(address.addressCountry)),
      }))
      .filter((location) => location.label)
    const argentinaLocations = locations.filter((location) => location.isArgentina)
    if (!argentinaLocations.length) continue

    const postingId = postingIdFromUrl(job.jobUrl, boardToken)
    if (!postingId || typeof job.title !== 'string' || !job.title.trim()) {
      throw new Error(`Ashby devolvió un aviso argentino sin título o enlace válido del tablero ${company}.`)
    }
    const orderedLocations = [...argentinaLocations, ...locations.filter((location) => !location.isArgentina)]
    const description = text(job.descriptionPlain) || text(job.descriptionHtml)
    argentinaJobs.push({
      title: job.title.trim(),
      jobUrl: job.jobUrl,
      description,
      company,
      location: [...new Set(orderedLocations.map((location) => location.label))].join('; '),
      publishedAt: text(job.publishedAt),
    })
  }

  if (argentinaJobs.length > ASHBY_MAX_ARGENTINA_POSTINGS) {
    throw new Error(`Ashby devolvió más de ${ASHBY_MAX_ARGENTINA_POSTINGS} avisos argentinos; no se importaron resultados parciales.`)
  }

  return { jobs: argentinaJobs }
}
