import type { JsonSourceConfig } from '../../src/shared/types'
import { normalizeSalaryCurrency, normalizeSalaryPeriod, parseSalaryAmount } from '../salary.ts'

export interface JsonFeedRecord {
  title: string
  url: string
  description: string
  company: string
  location: string
  salary: string
  publishedAt: string
}

type JsonPath = { field: keyof JsonSourceConfig; required: boolean }

const paths: JsonPath[] = [
  { field: 'itemsPath', required: true },
  { field: 'titlePath', required: true },
  { field: 'urlPath', required: true },
  { field: 'descriptionPath', required: false },
  { field: 'companyPath', required: false },
  { field: 'locationPath', required: false },
  { field: 'salaryPath', required: false },
  { field: 'salaryMinimumPath', required: false },
  { field: 'salaryMaximumPath', required: false },
  { field: 'salaryCurrencyPath', required: false },
  { field: 'salaryPeriodPath', required: false },
  { field: 'publishedAtPath', required: false },
  { field: 'filterPath', required: false },
]

export function validateJsonSourceConfig(input: unknown): JsonSourceConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El mapeo de campos JSON no tiene un formato válido.')
  }
  const value = input as Partial<JsonSourceConfig>
  const config = {} as JsonSourceConfig
  for (const { field, required } of paths) {
    const path = typeof value[field] === 'string' ? value[field].trim() : ''
    if (path.length > 400) throw new Error('Una ruta JSON supera el máximo de 400 caracteres.')
    if (required && !path && field !== 'itemsPath') throw new Error('Indicá la ruta del arreglo, el puesto y el enlace del aviso.')
    if (path) parsePointer(path)
    config[field] = path
  }
  config.filterValue = typeof value.filterValue === 'string' ? value.filterValue.trim() : ''
  if (config.filterValue.length > 200) throw new Error('El valor del filtro JSON supera el máximo de 200 caracteres.')
  if (Boolean(config.filterPath) !== Boolean(config.filterValue)) {
    throw new Error('Para filtrar avisos JSON indicá tanto la ruta como el valor esperado.')
  }
  const hasStructuredSalary = Boolean(config.salaryMinimumPath || config.salaryMaximumPath || config.salaryCurrencyPath || config.salaryPeriodPath)
  if (hasStructuredSalary && (!config.salaryMinimumPath || !config.salaryCurrencyPath || !config.salaryPeriodPath)) {
    throw new Error('Para mapear sueldo estructurado indicá mínimo, moneda y período; el máximo es opcional.')
  }
  return config
}

function parsePointer(pointer: string) {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error('Las rutas JSON deben usar JSON Pointer, por ejemplo /jobs/0/title.')
  const tokens = pointer.slice(1).split('/')
  if (tokens.some((token) => /~(?![01])/u.test(token))) {
    throw new Error('Una ruta JSON contiene un escape inválido; usá ~1 para / y ~0 para ~.')
  }
  return tokens.map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'))
}

function valueAt(document: unknown, pointer: string): unknown {
  let current = document
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(token)) return undefined
      current = current[Number(token)]
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token]
    } else {
      return undefined
    }
  }
  return current
}

const textAt = (item: unknown, pointer: string) => {
  if (!pointer) return ''
  const value = valueAt(item, pointer)
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function dateAt(item: unknown, pointer: string) {
  if (!pointer) return ''
  const value = valueAt(item, pointer)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = Math.abs(value) < 100_000_000_000 ? value * 1000 : value
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  return textAt(item, pointer)
}

function amountAt(item: unknown, pointer: string): number | null {
  if (!pointer) return null
  const value = valueAt(item, pointer)
  if (typeof value !== 'number' && typeof value !== 'string') return null
  return parseSalaryAmount(String(value))
}

function structuredSalaryAt(item: unknown, config: JsonSourceConfig) {
  if (!config.salaryMinimumPath || !config.salaryCurrencyPath || !config.salaryPeriodPath) return ''
  const minimum = amountAt(item, config.salaryMinimumPath)
  const maximum = amountAt(item, config.salaryMaximumPath)
  const rawCurrency = textAt(item, config.salaryCurrencyPath)
  const currency = normalizeSalaryCurrency(rawCurrency)
  const period = textAt(item, config.salaryPeriodPath)
  if (minimum === null || currency === null || !period) return ''
  if (maximum !== null && maximum < minimum) return ''
  const normalizedPeriod = normalizeSalaryPeriod(period) ?? 'periodo informado sin normalizar'
  const amounts = maximum === null ? String(minimum) : `${minimum} - ${maximum}`
  return `${amounts} ${currency} ${normalizedPeriod}`
}

export function jsonFeedItemCount(document: unknown, config: JsonSourceConfig): number {
  const rows = valueAt(document, config.itemsPath)
  if (!Array.isArray(rows)) throw new Error('La ruta indicada debe apuntar a un arreglo de avisos JSON.')
  return rows.length
}

export function mapJsonFeed(document: unknown, config: JsonSourceConfig, limit = 100): JsonFeedRecord[] {
  const rows = valueAt(document, config.itemsPath)
  if (!Array.isArray(rows)) throw new Error('La ruta indicada debe apuntar a un arreglo de avisos JSON.')
  const safeLimit = Number.isFinite(limit) ? Math.min(2000, Math.max(0, Math.floor(limit))) : 100
  const records = rows.slice(0, safeLimit).flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return []
    if (config.filterPath && textAt(row, config.filterPath).toLocaleLowerCase() !== config.filterValue.toLocaleLowerCase()) return []
    const title = textAt(row, config.titlePath)
    const url = textAt(row, config.urlPath)
    if (!title || !url) return []
    return [{
      title,
      url,
      description: textAt(row, config.descriptionPath),
      company: textAt(row, config.companyPath),
      location: textAt(row, config.locationPath),
      salary: structuredSalaryAt(row, config) || textAt(row, config.salaryPath),
      publishedAt: dateAt(row, config.publishedAtPath),
    }]
  })
  if (rows.length > 0 && records.length === 0) {
    throw new Error('No se encontraron puestos y enlaces en las rutas configuradas; revisá el mapeo JSON.')
  }
  return records
}
