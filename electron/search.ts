import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'rss-parser'
import type { CsvSourceConfig, FeedTestResult, GeorefLocalitySuggestion, JsonSourceConfig, OpportunityInput, SalaryExchangeRateSnapshot, SearchProfile, SearchRunResult, UserSource } from '../src/shared/types'
import type { RadarDatabase } from './database'
import { convertMonthlySalaryCurrency, parseMonthlySalary, salaryPeriodFromText } from './salary.ts'
import { currentSalaryExchangeRates } from './exchange-rates.ts'
import { fetchPinnedBytes, fetchPinnedText, resolvePublicHttpsTarget, type ResolvedFeedTarget } from './pinned-fetch.ts'
import { decodeCsvBytes } from '../src/shared/csv.ts'
import { mapJsonFeed, validateJsonSourceConfig } from './connectors/json-feed.ts'
import { mapCsvFeed, validateCsvSourceConfig } from './connectors/csv-feed.ts'
import { normalizeOpportunityUrl } from '../src/shared/opportunity-url.ts'
import { findVerifiedSourcePolicy } from '../src/shared/verified-source-policies.ts'
import { ashbyArgentinaPayload } from '../src/shared/ashby.ts'
import { greenhouseArgentinaPayload } from '../src/shared/greenhouse.ts'
import {
  SMARTRECRUITERS_MAX_POSTINGS,
  SMARTRECRUITERS_URL_BY_COMPANY,
  smartRecruitersDetailsPayload,
  smartRecruitersPostingIds,
  type SmartRecruitersCompany,
} from '../src/shared/smartrecruiters.ts'
import { workableArgentinaPayload } from '../src/shared/workable.ts'
import { fetchAllLeverPostings, LEVER_MAX_ARGENTINA_POSTINGS, LEVER_MAX_POSTINGS, leverArgentinaPayload } from '../src/shared/lever.ts'

const parser = new Parser({
  timeout: 15_000,
  customFields: {
    item: [
      'location', 'job:location', 'region', 'city', 'geo:placename',
      'salary', 'job:salary', 'salary_currency', 'salaryCurrency',
      'salary_period', 'salaryPeriod', 'salary_unit', 'salaryUnit',
    ],
  },
})
const maxLeverFeedBytes = 25 * 1024 * 1024

type FeedItem = {
  title?: string
  link?: string
  content?: string
  contentSnippet?: string
  summary?: string
  description?: string
  creator?: string
  author?: string
  pubDate?: string
  isoDate?: string
  location?: unknown
  region?: unknown
  city?: unknown
  'job:location'?: unknown
  'geo:placename'?: unknown
  salary?: unknown
  'job:salary'?: unknown
  salary_currency?: unknown
  salaryCurrency?: unknown
  salary_period?: unknown
  salaryPeriod?: unknown
  salary_unit?: unknown
  salaryUnit?: unknown
}

type AutomaticSourceKind = Exclude<UserSource['kind'], 'website'>
type MappedFeedRecord = {
  title: string
  url: string
  description: string
  company: string
  location: string
  salary: string
  publishedAt: string
}
type ConnectorAdapter = {
  fetch: (source: UserSource) => Promise<FeedItem[]>
  test: (url: string, config?: unknown) => Promise<FeedTestResult>
}

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()

function normalizeMatchText(value: string) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ')
}

function containsMatchPhrase(normalizedText: string, phrase: string) {
  const normalizedPhrase = normalizeMatchText(phrase)
  return normalizedPhrase.length > 0 && ` ${normalizedText} `.includes(` ${normalizedPhrase} `)
}

const searchStopWords = new Set(['para', 'con', 'sin', 'por', 'una', 'uno', 'unos', 'unas', 'que', 'como', 'desde', 'hasta', 'entre', 'sobre', 'este', 'esta', 'esto', 'trabajo', 'busco', 'buscar', 'puesto', 'puestos', 'experiencia', 'jornada', 'horario', 'disponibilidad', 'localidad', 'zona'])
const scheduleStopWords = new Set(['jornada', 'jornadas', 'horario', 'horarios', 'turno', 'turnos', 'tiempo', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'con', 'por'])

function normalizeScheduleToken(value: string) {
  const normalized = normalize(value)
  if (/\p{N}/u.test(normalized)) return normalized
  const stem = normalized.replace(/(?:as|os|a|o|s)$/u, '')
  if (['h', 'hr', 'hour', 'hor'].includes(stem)) return 'unit:hour'
  if (['d', 'day', 'di'].includes(stem)) return 'unit:day'
  if (['wk', 'week', 'weekly', 'seman'].includes(stem)) return 'unit:week'
  if (['shift', 'turn'].includes(stem)) return 'unit:shift'
  return stem
}

function tokenizeScheduleTerms(value: string) {
  return normalize(value).split(/[^\p{L}\p{N}]+/u).flatMap((term) => {
    const attachedNumberAndUnit = term.match(/^(\p{N}+)(h|hs|hr|hrs|hour|hours|hora|horas|d|day|days|dia|dias|wk|week|weeks)$/u)
    return attachedNumberAndUnit ? [attachedNumberAndUnit[1], attachedNumberAndUnit[2]] : [term]
  })
}

type GeorefLocality = { id: string; name: string; province: string; department: string; governmentLocal?: string; lat: number; lon: number }
const searchDirectory = path.dirname(fileURLToPath(import.meta.url))
const georefLocalities = JSON.parse(readFileSync(
  path.join(searchDirectory, '..', 'resources', 'georef', 'localities.json'),
  'utf8',
)) as GeorefLocality[]
const georefByName = new Map<string, GeorefLocality[]>()
const georefById = new Map<string, GeorefLocality>()
for (const locality of georefLocalities) {
  georefById.set(locality.id, locality)
  const key = normalizeLocationKey(locality.name)
  const matchingNames = georefByName.get(key)
  if (matchingNames) matchingNames.push(locality)
  else georefByName.set(key, [locality])
}

function normalizeLocationKey(value: string) {
  return normalizeMatchText(value)
}

function localityLabel(locality: GeorefLocality) {
  return [locality.name, locality.governmentLocal, locality.department, locality.province]
    .filter((part): part is string => Boolean(part))
    .join(', ')
}

function stripGeorefSelection(value: string) {
  return value.replace(/\s+\[Georef:[A-Za-z0-9_-]{1,80}\]\s*$/iu, '').trim()
}

export function searchGeorefLocalities(query: string): GeorefLocalitySuggestion[] {
  const normalizedQuery = normalizeLocationKey(query)
  if (normalizedQuery.length < 2) return []
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return georefLocalities
    .map((locality) => {
      const label = localityLabel(locality)
      const normalizedLabel = normalizeLocationKey(label)
      const normalizedName = normalizeLocationKey(locality.name)
      const matches = normalizedLabel.includes(normalizedQuery)
        || terms.every((term) => normalizedLabel.includes(term))
      if (!matches) return null
      const rank = normalizedLabel === normalizedQuery ? 0
        : normalizedName === normalizedQuery ? 1
          : normalizedName.startsWith(normalizedQuery) ? 2
            : normalizedLabel.includes(normalizedQuery) ? 3 : 4
      return { rank, locality, label }
    })
    .filter((match): match is { rank: number; locality: GeorefLocality; label: string } => match !== null)
    .sort((left, right) => left.rank - right.rank
      || left.label.localeCompare(right.label, 'es')
      || left.locality.id.localeCompare(right.locality.id))
    .slice(0, 12)
    .map(({ locality, label }) => ({ id: locality.id, label, lat: locality.lat, lon: locality.lon }))
}

function resolveLocality(value: string): GeorefLocality | null {
  const selectedId = value.match(/\s+\[Georef:([A-Za-z0-9_-]{1,80})\]\s*$/iu)?.[1]
  if (selectedId) return georefById.get(selectedId) ?? null
  value = stripGeorefSelection(value)
  const parts = value.split(/\s*(?:,|;|\s\|\s)\s*/).map(normalizeLocationKey).filter(Boolean)
  if (parts[parts.length - 1] === 'argentina') parts.pop()
  const hasGovernmentLocal = parts.length > 3
  const hasDepartment = parts.length > 2
  const name = hasGovernmentLocal
    ? parts.slice(0, -3).join(' ')
    : hasDepartment ? parts.slice(0, -2).join(' ') : parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
  const governmentLocal = hasGovernmentLocal ? parts[parts.length - 3] : undefined
  const department = hasDepartment ? parts[parts.length - 2] : undefined
  const province = parts.length > 1 ? parts[parts.length - 1] : undefined
  const matches = georefByName.get(name) ?? []
  const candidates = matches.filter((locality) =>
    (!province || normalizeLocationKey(locality.province) === province)
    && (!governmentLocal || normalizeLocationKey(locality.governmentLocal ?? '') === governmentLocal)
    && (!department || normalizeLocationKey(locality.department) === department))
  return candidates.length === 1 ? candidates[0] : null
}

function distanceKm(left: GeorefLocality, right: GeorefLocality) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDelta = radians(right.lat - left.lat)
  const lonDelta = radians(right.lon - left.lon)
  const leftLat = radians(left.lat)
  const rightLat = radians(right.lat)
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}


function fetchPinnedXml(target: ResolvedFeedTarget) {
  return fetchPinnedText(target, 'application/rss+xml, application/atom+xml, application/xml, text/xml')
}

async function fetchFeed(url: string) {
  const target = await resolvePublicHttpsTarget(url)
  const xml = await fetchPinnedXml(target)
  const parsed = await parser.parseString(xml)
  return parsed.items as FeedItem[]
}

export async function testRssFeed(url: string): Promise<FeedTestResult> {
  const items = await fetchFeed(url)
  return {
    itemCount: items.length,
    sampleTitles: items.slice(0, 3).map((item) => item.title?.trim() || 'Aviso sin título'),
  }
}

async function parseJsonResponse(json: string): Promise<unknown> {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    throw new Error('La fuente no devolvió un documento JSON válido.')
  }
  return payload
}

async function mapConcurrentOrdered<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  const controller = new AbortController()
  let nextIndex = 0
  let failure: unknown
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (failure === undefined && !controller.signal.aborted) {
      const index = nextIndex++
      if (index >= items.length) return
      try {
        results[index] = await mapper(items[index], index, controller.signal)
      } catch (error) {
        if (failure === undefined) failure = error
        controller.abort()
      }
    }
  })
  await Promise.all(workers)
  if (failure !== undefined) throw failure
  return results
}

async function fetchSmartRecruitersPayload(url: string, company: SmartRecruitersCompany) {
  if (url !== SMARTRECRUITERS_URL_BY_COMPANY[company]) throw new Error('El endpoint de SmartRecruiters no coincide con la política verificada.')
  const target = await resolvePublicHttpsTarget(url)
  const list = await parseJsonResponse(await fetchPinnedText(target, 'application/json'))
  const postingIds = smartRecruitersPostingIds(list, company)
  let totalDetailBytes = 0
  const details = await mapConcurrentOrdered(postingIds, 4, async (postingId, _index, signal) => {
    const detailUrl = new URL(target.url)
    detailUrl.pathname = `/v1/companies/${company}/postings/${postingId}`
    detailUrl.search = ''
    const detailText = await fetchPinnedText({ ...target, url: detailUrl }, 'application/json', 1024 * 1024, signal)
    const detailBytes = Buffer.byteLength(detailText, 'utf8')
    if (totalDetailBytes + detailBytes > 25 * 1024 * 1024) {
      throw new Error(`Los detalles de SmartRecruiters superan el límite de 25 MB por consulta (${SMARTRECRUITERS_MAX_POSTINGS} avisos como máximo).`)
    }
    totalDetailBytes += detailBytes
    return parseJsonResponse(detailText)
  })
  return smartRecruitersDetailsPayload(list, details, company)
}

async function fetchJsonFeed(url: string, config: JsonSourceConfig) {
  const policy = findVerifiedSourcePolicy('json', url)
  let payload: unknown
  if (policy?.connector === 'smartrecruiters-posting-details') {
    if (!policy.smartRecruitersCompany) throw new Error('La política de SmartRecruiters no identifica la empresa revisada.')
    payload = await fetchSmartRecruitersPayload(url, policy.smartRecruitersCompany)
  } else if (policy?.connector === 'lever-public-jobs') {
    const target = await resolvePublicHttpsTarget(url)
    let totalBytes = 0
    const postings = await fetchAllLeverPostings(async (skip) => {
      const pageUrl = new URL(target.url)
      pageUrl.searchParams.set('skip', String(skip))
      const responseText = await fetchPinnedText({ ...target, url: pageUrl }, 'application/json')
      totalBytes += Buffer.byteLength(responseText, 'utf8')
      if (totalBytes > maxLeverFeedBytes) {
        throw new Error('La respuesta paginada de Lever supera el límite de 25 MB; no se importó la fuente.')
      }
      return parseJsonResponse(responseText)
    })
    payload = leverArgentinaPayload(
      postings,
      policy?.leverArgentinaMaxPostings ?? LEVER_MAX_ARGENTINA_POSTINGS,
      policy?.leverArgentinaLocationLabels,
    )
  } else {
    const response = await parseJsonResponse(await fetchPinnedText(await resolvePublicHttpsTarget(url), 'application/json'))
    if (policy?.connector === 'greenhouse-public-jobs') {
      payload = greenhouseArgentinaPayload(
        response,
        policy.greenhouseBoardToken ?? '',
        policy.greenhouseCompanyName ?? policy.sourceName ?? policy.title,
        policy.greenhouseArgentinaRegionalLocationLabels,
        policy.greenhouseCustomCareerUrlPatterns,
      )
    } else if (policy?.connector === 'ashby-public-jobs') {
      payload = ashbyArgentinaPayload(response, policy.ashbyBoardToken ?? '', policy.ashbyCompanyName ?? policy.sourceName ?? policy.title)
    } else if (policy?.connector === 'workable-sur-public-jobs') {
      payload = workableArgentinaPayload(response)
    } else {
      payload = response
    }
  }
  return mapJsonFeed(payload, config, policy?.connector === 'lever-public-jobs' ? LEVER_MAX_POSTINGS : 100)
}

export async function testJsonFeed(url: string, rawConfig: unknown): Promise<FeedTestResult> {
  const config = validateJsonSourceConfig(rawConfig)
  const items = await fetchJsonFeed(url, config)
  return {
    itemCount: items.length,
    sampleTitles: items.slice(0, 3).map((item) => item.title || 'Aviso sin título'),
  }
}

async function fetchCsvFeed(url: string, config: CsvSourceConfig) {
  const target = await resolvePublicHttpsTarget(url)
  const raw = await fetchPinnedBytes(target, 'text/csv, text/plain')
  const csv = decodeCsvBytes(raw).contents
  return mapCsvFeed(csv, config)
}

export async function testCsvFeed(url: string, rawConfig: unknown): Promise<FeedTestResult> {
  const config = validateCsvSourceConfig(rawConfig)
  const items = await fetchCsvFeed(url, config)
  return {
    itemCount: items.length,
    sampleTitles: items.slice(0, 3).map((item) => item.title || 'Aviso sin título'),
  }
}

function mappedRecordsToFeedItems(records: MappedFeedRecord[]): FeedItem[] {
  return records.map((item) => ({
    title: item.title,
    link: item.url,
    description: item.description,
    author: item.company,
    location: item.location,
    salary: item.salary,
    pubDate: item.publishedAt,
  }))
}

/**
 * Automatic source protocols register one fetch and preview adapter here.
 * New connector code stays behind the same HTTPS transport and normalized feed pipeline.
 */
const connectorAdapters: Record<AutomaticSourceKind, ConnectorAdapter> = {
  rss: {
    fetch: (source) => fetchFeed(source.url),
    test: (url) => testRssFeed(url),
  },
  json: {
    fetch: async (source) => {
      if (!source.jsonConfig) throw new Error('El mapeo de campos JSON no está disponible. Volvé a configurar esta fuente.')
      return mappedRecordsToFeedItems(await fetchJsonFeed(source.url, source.jsonConfig))
    },
    test: (url, config) => testJsonFeed(url, config),
  },
  csv: {
    fetch: async (source) => {
      if (!source.csvConfig) throw new Error('El mapeo de columnas CSV no está disponible. Volvé a configurar esta fuente.')
      return mappedRecordsToFeedItems(await fetchCsvFeed(source.url, source.csvConfig))
    },
    test: (url, config) => testCsvFeed(url, config),
  },
}

export function testConnector(kind: AutomaticSourceKind, url: string, config?: unknown) {
  return connectorAdapters[kind].test(url, config)
}

type FitResult = { score: number | null; reasons: string[]; missing: string[] }

function feedSalaryText(item: FeedItem) {
  return [
    item.salary_currency,
    item.salaryCurrency,
    item.salary,
    item['job:salary'],
    item.salary_period,
    item.salaryPeriod,
    item.salary_unit,
    item.salaryUnit,
  ]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 300)
}

export function calculateFit(
  profile: SearchProfile | undefined,
  title: string,
  description: string,
  location: string,
  salaryText = '',
  salaryExchangeRates: SalaryExchangeRateSnapshot | null = null,
): FitResult | null {
  if (!profile) return { score: null, reasons: [], missing: [] }
  const body = normalize(`${title} ${description}`)
  const normalizedBody = normalizeMatchText(body)
  const bodyIncludesPhrase = (phrase: string) => containsMatchPhrase(normalizedBody, phrase)
  const normalizedLocation = normalizeMatchText(location)
  const excluded = profile.excludeKeywords.find((term) => term && bodyIncludesPhrase(term))
  if (excluded) return null

  const reasons: string[] = []
  const missing: string[] = []
  const matchedRoles = profile.roles.filter((role) => role && bodyIncludesPhrase(role))
  const matchedTerms = profile.includeKeywords.filter((term) => term && bodyIncludesPhrase(term))
  const explicitTerms = [...profile.roles, ...profile.includeKeywords].map(normalize)
  const describedTerms = [...new Set(normalize(profile.searchDescription).split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 3 && !searchStopWords.has(term) && !explicitTerms.some((explicit) => explicit.includes(term))))]
  const matchedDescriptionTerms = describedTerms.filter(bodyIncludesPhrase)
  let score = 0

  if (matchedRoles.length > 0) {
    score += 40
    reasons.push(`Menciona el puesto: ${matchedRoles.slice(0, 2).join(', ')}`)
  } else if (profile.roles.length > 0) {
    missing.push(`El aviso no menciona: ${profile.roles.slice(0, 2).join(', ')}`)
  }

  if (matchedTerms.length > 0) {
    score += Math.min(25, matchedTerms.length * 8)
    reasons.push(`Coincide con: ${matchedTerms.slice(0, 3).join(', ')}`)
  } else if (profile.includeKeywords.length > 0) {
    missing.push(`No se detectan estas palabras: ${profile.includeKeywords.slice(0, 2).join(', ')}`)
  }

  if (matchedDescriptionTerms.length > 0) {
    score += Math.min(15, matchedDescriptionTerms.length * 3)
    reasons.push(`Coincide con tu descripción: ${matchedDescriptionTerms.slice(0, 3).join(', ')}`)
  }

  const matchedLocation = profile.locations.find((item) => item && containsMatchPhrase(normalizedLocation, stripGeorefSelection(item)))
  if (profile.locations.length > 0 && !location) {
    missing.push('El aviso no informa la ubicación')
  } else if (profile.locations.length > 0) {
    const origins = profile.locations.map(resolveLocality)
    const knownOrigins = origins.filter((origin): origin is GeorefLocality => origin !== null)
    const hasUnknownOrigin = knownOrigins.length !== origins.length
    const destination = resolveLocality(location)
    const canCalculateRadius = profile.radiusKm > 0
      && knownOrigins.length > 0
      && destination !== null

    if (canCalculateRadius) {
      const nearestOrigin = knownOrigins
        .map((origin) => ({ origin, distance: distanceKm(origin, destination) }))
        .sort((left, right) => left.distance - right.distance)[0]
      if (nearestOrigin.distance > profile.radiusKm) {
        if (!hasUnknownOrigin) return null
        missing.push('El aviso no se descartó por radio porque alguna localidad de origen no pudo resolverse de forma inequívoca')
      } else {
        score += 15
      }
      reasons.push(`A ${Math.round(nearestOrigin.distance)} km de ${nearestOrigin.origin.name} en línea recta (Georef)`)
    } else {
      if (matchedLocation) {
        score += 15
        reasons.push(`Ubicación en ${stripGeorefSelection(matchedLocation)}`)
      }
      if (profile.radiusKm > 0) {
        missing.push('No se pudo calcular la distancia con una localidad oficial inequívoca; se conserva el aviso sin aplicar el radio')
      } else if (!matchedLocation) {
        missing.push('La ubicación no coincide con las zonas elegidas')
      }
    }
  }

  if (profile.workMode !== 'indistinto') {
    const modeLabel = profile.workMode === 'hibrido' ? 'híbrido' : profile.workMode === 'remoto' ? 'remoto' : 'presencial'
    const modeTerms = profile.workMode === 'hibrido'
      ? ['híbrido', 'hybrid', 'partly remote', 'partially remote']
      : profile.workMode === 'remoto'
        ? ['remoto', 'remote', 'work from home', 'work from anywhere', 'fully distributed']
        : ['presencial', 'on-site', 'on site', 'onsite', 'in-person', 'in person', 'in-office', 'in office', 'office-based']
    if (modeTerms.some(bodyIncludesPhrase)) {
      score += 10
      reasons.push(`Menciona modalidad ${modeLabel}`)
    } else {
      missing.push(`No confirma modalidad ${modeLabel}`)
    }
  }

  if (profile.minimumSalary !== null) {
    const publishedSalary = parseMonthlySalary(salaryText, profile)
    const currency = profile.minimumSalaryCurrency ?? 'ARS'
    let salaryConfirmed = false
    if (!publishedSalary) {
      const sourcePeriod = salaryPeriodFromText(salaryText)
      if (sourcePeriod === 'daily' && profile.workDaysPerWeek == null) {
        missing.push('El aviso informa un sueldo diario; configurá los días remunerados por semana para compararlo. Se conserva sin aplicar el mínimo.')
      } else if (sourcePeriod === 'hourly' && profile.workHoursPerWeek == null) {
        missing.push('El aviso informa un sueldo por hora; configurá las horas remuneradas por semana para compararlo. Se conserva sin aplicar el mínimo.')
      } else {
        missing.push(`La fuente no publicó un sueldo mensual, anual, semanal, diario u horario comparable con moneda explícita; no se aplicó el mínimo de ${currency}`)
      }
    } else if (publishedSalary.currency !== currency) {
      const converted = profile.convertSalaryCurrencies
        ? convertMonthlySalaryCurrency(publishedSalary, currency, salaryExchangeRates)
        : null
      if (!converted) {
        missing.push(profile.convertSalaryCurrencies
          ? `No hay una cotización BCRA vigente para comparar ${publishedSalary.currency} con ${currency}; se conserva el aviso sin aplicar el mínimo`
          : `El aviso publica ${publishedSalary.currency}; no se compara con el mínimo en ${currency}`)
      } else if (converted.upperBound < profile.minimumSalary) {
        return null
      } else {
        const sourcePeriod = {
          monthly: 'sueldo mensual',
          annual: 'sueldo anual dividido por 12',
          weekly: 'sueldo semanal anualizado con 52 semanas dividido por 12',
          daily: `sueldo diario anualizado con ${profile.workDaysPerWeek} días remunerados por semana y 52 semanas por año`,
          hourly: `sueldo horario anualizado con ${profile.workHoursPerWeek} horas remuneradas por semana y 52 semanas por año`,
        }[publishedSalary.sourcePeriod]
        const formatMoney = (amount: number, code: string) => new Intl.NumberFormat('es-AR', {
          style: 'currency',
          currency: code,
          currencyDisplay: 'code',
          maximumFractionDigits: 2,
        }).format(amount)
        reasons.push(`${sourcePeriod} de ${publishedSalary.currency} equivale a ${formatMoney(converted.lowerBound, currency)}–${formatMoney(converted.upperBound, currency)} con la referencia BCRA del ${salaryExchangeRates!.asOf}`)
        if (converted.lowerBound < profile.minimumSalary) {
          missing.push(`El rango convertido incluye importes por debajo del mínimo de ${currency}; se conserva sin confirmar`)
        } else {
          score += 15
          salaryConfirmed = true
          reasons.push(`El sueldo convertido alcanza el mínimo mensual configurado en ${currency}`)
        }
      }
    } else if (publishedSalary.upperBound < profile.minimumSalary) {
      return null
    } else if (publishedSalary.lowerBound < profile.minimumSalary) {
      missing.push(`El rango salarial incluye importes por debajo del m\u00ednimo de ${currency}; se conserva sin confirmar`)
    } else {
      score += 15
      salaryConfirmed = true
      const periodDescription = {
        monthly: `El sueldo mensual publicado en ${currency}`,
        annual: `El sueldo anual publicado en ${currency}, dividido por 12`,
        weekly: `El sueldo semanal publicado en ${currency}, anualizado con 52 semanas y dividido por 12`,
        daily: `El sueldo diario publicado en ${currency}, anualizado con ${profile.workDaysPerWeek} días remunerados por semana`,
        hourly: `El sueldo por hora publicado en ${currency}, anualizado con ${profile.workHoursPerWeek} horas remuneradas por semana`,
      }[publishedSalary.sourcePeriod]
      reasons.push(`${periodDescription}, alcanza el mínimo mensual configurado`)
    }
    if (profile.requireSalaryMatch && !salaryConfirmed) return null
  }
  if (profile.schedule) {
    const shortScheduleUnits = new Set(['h', 'hs', 'hr', 'hrs', 'd', 'wk'])
    const scheduleTerms = tokenizeScheduleTerms(profile.schedule)
      .filter((term) => (term.length > 2 || /\p{N}/u.test(term) || shortScheduleUnits.has(term)) && !scheduleStopWords.has(term))
      .map(normalizeScheduleToken)
    const postingTerms = tokenizeScheduleTerms(body).map(normalizeScheduleToken)
    const postingTermSet = new Set(postingTerms)
    const numericUnitPairs = scheduleTerms.flatMap((term, index) => {
      if (!/\p{N}/u.test(term)) return []
      const unit = [scheduleTerms[index - 1], scheduleTerms[index + 1]]
        .find((candidate) => candidate?.startsWith('unit:'))
      return unit ? [{ term, unit }] : []
    })
    const numbersMatchTheirUnits = numericUnitPairs.every(({ term, unit }) => postingTerms.some((postingTerm, index) =>
      postingTerm === term && (postingTerms[index - 1] === unit || postingTerms[index + 1] === unit)))
    const scheduleConfirmed = scheduleTerms.length > 0
      && scheduleTerms.every((term) => postingTermSet.has(term))
      && numbersMatchTheirUnits
    if (!scheduleConfirmed) {
      if (profile.requireScheduleMatch) return null
      missing.push(`No confirma el horario: ${profile.schedule}`)
    }
  }

  return { score: Math.min(score, 100), reasons, missing }
}

const dateOrNull = (value?: string) => {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function profileForItem(
  source: UserSource,
  profiles: SearchProfile[],
  item: FeedItem,
  salaryExchangeRates: SalaryExchangeRateSnapshot | null = null,
) {
  const candidates = source.profileId
    ? profiles.filter((profile) => profile.id === source.profileId && profile.active)
    : profiles.filter((profile) => profile.active)
  const title = item.title?.trim() || 'Aviso sin título'
  const description = item.contentSnippet || item.description || item.summary || item.content || ''
  const salaryText = feedSalaryText(item)
  const locationValue = [item.location, item['job:location'], item['geo:placename'], item.region, item.city]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const location = locationValue?.trim().slice(0, 300) ?? ''
  const scored = candidates
    .map((profile) => ({ profile, result: calculateFit(profile, title, description, location, salaryText, salaryExchangeRates) }))
    .filter((entry): entry is { profile: SearchProfile; result: NonNullable<ReturnType<typeof calculateFit>> } => entry.result !== null)
    .sort((left, right) => (right.result.score ?? 0) - (left.result.score ?? 0))
  if (!scored.length) {
    const excluded = candidates.length > 0 || Boolean(source.profileId)
    return { profile: undefined, fit: calculateFit(undefined, title, description, location, salaryText)!, excluded }
  }
  return { profile: scored[0].profile, fit: scored[0].result, excluded: false }
}

function itemToOpportunity(
  source: UserSource,
  profiles: SearchProfile[],
  item: FeedItem,
  salaryExchangeRates: SalaryExchangeRateSnapshot | null = null,
): OpportunityInput | null {
  const rawLink = item.link?.trim()
  if (!rawLink) return null
  let normalizedUrl: string
  try {
    normalizedUrl = normalizeOpportunityUrl(new URL(rawLink, source.url).toString())
  } catch {
    return null
  }

  const title = item.title?.trim() || 'Aviso sin título'
  const description = (item.contentSnippet || item.description || item.summary || item.content || '').trim().slice(0, 12_000)
  const salaryText = feedSalaryText(item)
  const picked = profileForItem(source, profiles, { ...item, title, description }, salaryExchangeRates)
  if (picked.excluded) return null
  const feedAuthor = item.creator || item.author || ''
  return {
    profileId: picked.profile?.id ?? null,
    title: title.slice(0, 200),
    company: feedAuthor.slice(0, 200) || source.name,
    location: [item.location, item['job:location'], item['geo:placename'], item.region, item.city]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim().slice(0, 300) ?? '',
    source: source.name,
    url: normalizedUrl,
    description,
    salaryText,
    matchScore: picked.fit.score,
    matchReasons: picked.fit.reasons,
    missingRequirements: picked.fit.missing,
    publishedAt: dateOrNull(item.isoDate || item.pubDate),
  }
}

export async function runSearch(
  database: RadarDatabase,
  options: {
    fetchSource?: (source: UserSource) => Promise<FeedItem[]>
    getSalaryExchangeRates?: () => Promise<SalaryExchangeRateSnapshot | null>
  } = {},
): Promise<SearchRunResult> {
  const activeSources = database.enabledSources()
  const fetchSource = options.fetchSource ?? ((source: UserSource) => {
    if (source.kind === 'website') return Promise.resolve([])
    return connectorAdapters[source.kind].fetch(source)
  })
  const profiles = database.listProfiles()
  const needsSalaryExchangeRates = profiles.some((profile) =>
    profile.active && profile.minimumSalary !== null && profile.convertSalaryCurrencies,
  )
  let salaryExchangeRates: SalaryExchangeRateSnapshot | null = null
  if (needsSalaryExchangeRates) {
    salaryExchangeRates = options.getSalaryExchangeRates
      ? await options.getSalaryExchangeRates()
      : await currentSalaryExchangeRates(database)
  }
  let added = 0
  let checkedSources = 0
  const errors: SearchRunResult['errors'] = []
  const truncated: SearchRunResult['truncated'] = []

  for (const source of activeSources) {
    if (source.kind === 'website') continue
    checkedSources += 1
    try {
      const items = await fetchSource(source)
      const policy = source.kind === 'json' ? findVerifiedSourcePolicy('json', source.url) : null
      const itemLimit = policy?.connector === 'lever-public-jobs'
        ? policy.leverArgentinaMaxPostings ?? LEVER_MAX_ARGENTINA_POSTINGS
        : 100
      const truncatedItems = items.length > itemLimit ? items.length - itemLimit : 0
      for (const item of items.slice(0, itemLimit)) {
        const opportunity = itemToOpportunity(source, profiles, item, salaryExchangeRates)
        if (opportunity && database.addOpportunityIfNew(opportunity)) added += 1
      }
      if (truncatedItems > 0) {
        truncated.push({
          sourceId: source.id,
          sourceName: source.name,
          message: `Se conservaron ${itemLimit} de ${items.length} avisos por el límite de ${itemLimit} por consulta; ${truncatedItems} no se revisaron.`.slice(0, 500),
        })
      }
      database.markSourceChecked(source.id, new Date().toISOString())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo consultar la fuente.'
      database.markSourceFailed(source.id, new Date().toISOString(), message)
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        message: message.slice(0, 500),
      })
    }
  }

  return { added, checkedSources, errors, truncated }
}
