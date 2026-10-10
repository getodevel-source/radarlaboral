import type { CsvSourceConfig } from '../../src/shared/types'
import { parseCsvRows } from '../../src/shared/csv.ts'
import { normalizeSalaryCurrency, normalizeSalaryPeriod, parseSalaryAmount } from '../salary.ts'

export interface CsvFeedRecord {
  title: string
  url: string
  description: string
  company: string
  location: string
  salary: string
  publishedAt: string
}

type CsvColumn = { field: Exclude<keyof CsvSourceConfig, 'delimiter'>; required?: boolean }

const columns: CsvColumn[] = [
  { field: 'titleColumn', required: true },
  { field: 'urlColumn', required: true },
  { field: 'descriptionColumn' },
  { field: 'companyColumn' },
  { field: 'locationColumn' },
  { field: 'salaryColumn' },
  { field: 'salaryMinimumColumn' },
  { field: 'salaryMaximumColumn' },
  { field: 'salaryCurrencyColumn' },
  { field: 'salaryPeriodColumn' },
  { field: 'publishedAtColumn' },
]

export function validateCsvSourceConfig(input: unknown): CsvSourceConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El mapeo de columnas CSV no tiene un formato válido.')
  }
  const value = input as Partial<CsvSourceConfig>
  const delimiter = value.delimiter
  if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') {
    throw new Error('Elegí coma, punto y coma o tabulación como separador CSV.')
  }
  const config = { delimiter } as CsvSourceConfig
  for (const { field, required } of columns) {
    const column = typeof value[field] === 'string' ? value[field].trim() : ''
    if (column.length > 200) throw new Error('Un encabezado CSV supera el máximo de 200 caracteres.')
    if (required && !column) throw new Error('Indicá los encabezados del puesto y del enlace del aviso.')
    config[field] = column
  }
  const hasStructuredSalary = Boolean(config.salaryMinimumColumn || config.salaryMaximumColumn || config.salaryCurrencyColumn || config.salaryPeriodColumn)
  if (hasStructuredSalary && (!config.salaryMinimumColumn || !config.salaryCurrencyColumn || !config.salaryPeriodColumn)) {
    throw new Error('Para mapear sueldo estructurado indicá mínimo, moneda y período; el máximo es opcional.')
  }
  return config
}

const textIn = (row: string[], positions: Map<string, number>, column: string) => {
  if (!column) return ''
  const position = positions.get(column)
  return position === undefined ? '' : (row[position] ?? '').trim()
}

function structuredSalaryIn(row: string[], positions: Map<string, number>, config: CsvSourceConfig) {
  if (!config.salaryMinimumColumn || !config.salaryCurrencyColumn || !config.salaryPeriodColumn) return ''
  const minimum = parseSalaryAmount(textIn(row, positions, config.salaryMinimumColumn))
  const maximum = parseSalaryAmount(textIn(row, positions, config.salaryMaximumColumn))
  const rawCurrency = textIn(row, positions, config.salaryCurrencyColumn)
  const currency = normalizeSalaryCurrency(rawCurrency) ?? rawCurrency.toUpperCase()
  const period = textIn(row, positions, config.salaryPeriodColumn)
  if (minimum === null || !/^[A-Z]{3}$/u.test(currency) || !period) return ''
  if (maximum !== null && maximum < minimum) return ''
  const normalizedPeriod = normalizeSalaryPeriod(period) ?? 'periodo informado sin normalizar'
  const amounts = maximum === null ? String(minimum) : `${minimum} - ${maximum}`
  return `${amounts} ${currency} ${normalizedPeriod}`
}

export function mapCsvFeed(input: string, rawConfig: unknown, maximumRecords = 100): CsvFeedRecord[] {
  if (!Number.isInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 1000) {
    throw new Error('El límite de avisos CSV no es válido.')
  }
  const config = validateCsvSourceConfig(rawConfig)
  const rows = parseCsvRows(input, config.delimiter)
  if (!rows.length) throw new Error('El CSV está vacío y no contiene encabezados.')

  const headers = rows[0].map((header) => header.trim())
  if (headers.some((header) => !header)) throw new Error('Todos los encabezados de la primera fila CSV deben tener un nombre.')
  if (headers.length > 100) throw new Error('El CSV supera el límite de 100 columnas.')
  const positions = new Map<string, number>()
  for (const [index, header] of headers.entries()) {
    if (positions.has(header)) throw new Error(`El CSV repite el encabezado “${header}”.`)
    positions.set(header, index)
  }
  const missing = [config.titleColumn, config.urlColumn].filter((column) => !positions.has(column))
  if (missing.length) throw new Error(`No se encontraron los encabezados configurados: ${missing.join(', ')}.`)

  const records = rows.slice(1, maximumRecords + 1).flatMap((row) => {
    const title = textIn(row, positions, config.titleColumn)
    const url = textIn(row, positions, config.urlColumn)
    if (!title || !url) return []
    return [{
      title: title.slice(0, 200),
      url: url.slice(0, 2000),
      description: textIn(row, positions, config.descriptionColumn).slice(0, 12_000),
      company: textIn(row, positions, config.companyColumn).slice(0, 200),
      location: textIn(row, positions, config.locationColumn).slice(0, 300),
      salary: structuredSalaryIn(row, positions, config) || textIn(row, positions, config.salaryColumn).slice(0, 300),
      publishedAt: textIn(row, positions, config.publishedAtColumn).slice(0, 100),
    }]
  })
  if (rows.length > 1 && !records.length) {
    throw new Error('No se encontraron puestos y enlaces con los encabezados configurados; revisá el mapeo CSV.')
  }
  return records
}
