import { mapCsvFeed, validateCsvSourceConfig } from './connectors/csv-feed.ts'
import { calculateFit } from './search.ts'
import { parseCsvRows } from '../src/shared/csv.ts'
import { normalizeOpportunityUrl } from '../src/shared/opportunity-url.ts'
import type { CsvLocalImportInput, CsvLocalImportResult, OpportunityInput } from '../src/shared/types'
import type { RadarDatabase } from './database'

const maxCsvBytes = 5 * 1024 * 1024

export function importLocalCsv(input: unknown, database: RadarDatabase): CsvLocalImportResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Los datos de importación no tienen un formato válido.')
  }
  const value = input as Partial<CsvLocalImportInput>
  if (typeof value.contents !== 'string' || Buffer.byteLength(value.contents, 'utf8') > maxCsvBytes) {
    throw new Error('Elegí un CSV de hasta 5 MB.')
  }
  const sourceName = typeof value.sourceName === 'string' ? value.sourceName.trim().slice(0, 120) : ''
  if (!sourceName) throw new Error('Indicá el portal o la procedencia del archivo.')
  const config = validateCsvSourceConfig(value.config)
  const profileId = typeof value.profileId === 'string' && value.profileId.trim() ? value.profileId.trim() : null
  const profile = profileId ? database.listProfiles().find((item) => item.id === profileId) : undefined
  if (profileId && !profile) throw new Error('El perfil seleccionado ya no existe. Elegí otro.')

  const rows = parseCsvRows(value.contents, config.delimiter)
  const nonemptyRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0)).length
  const records = mapCsvFeed(value.contents, config, 1000)
  const salaryExchangeRates = database.salaryExchangeRates()
  let skipped = Math.max(0, nonemptyRows - records.length)
  let filtered = 0
  const opportunities: OpportunityInput[] = []

  for (const record of records) {
    try {
      const url = normalizeOpportunityUrl(record.url)
      const fit = calculateFit(profile, record.title, record.description, record.location, record.salary, salaryExchangeRates)
      if (!fit) {
        filtered += 1
        continue
      }
      opportunities.push({
        profileId,
        title: record.title,
        company: record.company || 'Empresa no informada',
        location: record.location,
        source: sourceName,
        url,
        description: record.description,
        salaryText: record.salary,
        matchScore: fit.score,
        matchReasons: fit.reasons,
        missingRequirements: fit.missing,
        publishedAt: Number.isFinite(Date.parse(record.publishedAt)) ? new Date(record.publishedAt).toISOString() : null,
      })
    } catch {
      skipped += 1
    }
  }

  const { added, duplicates } = database.addOpportunitiesIfNew(opportunities)
  return { added, duplicates, skipped, filtered }
}
