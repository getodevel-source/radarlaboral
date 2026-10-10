import { calculateFit } from './search.ts'
import { jsonFeedItemCount, mapJsonFeed, validateJsonSourceConfig } from './connectors/json-feed.ts'
import { normalizeOpportunityUrl } from '../src/shared/opportunity-url.ts'
import type {
  JsonLocalImportInput,
  JsonLocalImportPreview,
  JsonLocalImportResult,
  OpportunityInput,
} from '../src/shared/types'
import type { RadarDatabase } from './database'

const maxJsonBytes = 5 * 1024 * 1024

type PreparedJsonImport = {
  preview: JsonLocalImportPreview
  opportunities: OpportunityInput[]
}

function prepareLocalJsonImport(input: unknown, database: RadarDatabase): PreparedJsonImport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Los datos de importación no tienen un formato válido.')
  }
  const value = input as Partial<JsonLocalImportInput>
  if (typeof value.contents !== 'string' || Buffer.byteLength(value.contents, 'utf8') > maxJsonBytes) {
    throw new Error('Elegí un archivo JSON local de hasta 5 MB.')
  }
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : ''
  if (!sourceId) throw new Error('Elegí una fuente JSON guardada para usar su mapeo.')
  const source = database.listSources().find((item) => item.id === sourceId)
  if (!source || source.kind !== 'json' || !source.jsonConfig) {
    throw new Error('La fuente JSON elegida ya no está disponible o no tiene un mapeo válido.')
  }

  let document: unknown
  try {
    document = JSON.parse(value.contents.charCodeAt(0) === 0xfeff ? value.contents.slice(1) : value.contents)
  } catch {
    throw new Error('El archivo no contiene un documento JSON válido.')
  }

  const config = validateJsonSourceConfig(source.jsonConfig)
  const itemCount = jsonFeedItemCount(document, config)
  const records = mapJsonFeed(document, config, 1000)
  const salaryExchangeRates = database.salaryExchangeRates()
  const skipped = Math.max(0, itemCount - records.length)
  const profileId = typeof value.profileId === 'string' && value.profileId.trim() ? value.profileId.trim() : null
  const profile = profileId ? database.listProfiles().find((item) => item.id === profileId) : undefined
  if (profileId && !profile) throw new Error('El perfil seleccionado ya no existe. Elegí otro.')

  const opportunities: OpportunityInput[] = []
  const sampleSource: Array<{ title: string; company: string; url: string }> = []
  let filtered = 0
  let invalidUrls = 0
  for (const record of records) {
    let url: string
    try {
      url = normalizeOpportunityUrl(new URL(record.url, source.url).toString())
    } catch {
      invalidUrls += 1
      continue
    }
    if (sampleSource.length < 3) {
      sampleSource.push({ title: record.title, company: record.company || 'Empresa no informada', url })
    }
    const fit = calculateFit(profile, record.title, record.description, record.location, record.salary, salaryExchangeRates)
    if (!fit) {
      filtered += 1
      continue
    }
    opportunities.push({
      profileId,
      title: record.title.slice(0, 200),
      company: (record.company || 'Empresa no informada').slice(0, 200),
      location: record.location.slice(0, 300),
      source: source.name,
      url: url.slice(0, 2000),
      description: record.description.slice(0, 12_000),
      salaryText: record.salary.slice(0, 300),
      matchScore: fit.score,
      matchReasons: fit.reasons,
      missingRequirements: fit.missing,
      publishedAt: Number.isFinite(Date.parse(record.publishedAt)) ? new Date(record.publishedAt).toISOString() : null,
    })
  }

  const preview: JsonLocalImportPreview = {
    itemCount,
    mappedCount: records.length,
    skipped: skipped + invalidUrls,
    filtered,
    samples: sampleSource,
  }
  return { preview, opportunities }
}

export function previewLocalJsonImport(input: unknown, database: RadarDatabase): JsonLocalImportPreview {
  return prepareLocalJsonImport(input, database).preview
}

export function importLocalJson(input: unknown, database: RadarDatabase): JsonLocalImportResult {
  const prepared = prepareLocalJsonImport(input, database)
  const { added, duplicates } = database.addOpportunitiesIfNew(prepared.opportunities)
  return {
    added,
    duplicates,
    skipped: prepared.preview.skipped,
    filtered: prepared.preview.filtered,
  }
}
