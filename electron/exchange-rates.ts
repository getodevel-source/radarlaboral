import { SALARY_CURRENCIES } from '../src/shared/types.ts'
import type { SalaryCurrency, SalaryExchangeRateSnapshot } from '../src/shared/types.ts'
import { isSalaryExchangeRateSnapshot, isSalaryExchangeRateSnapshotUsable, shouldRefreshSalaryExchangeRates } from '../src/shared/salary-exchange-rates.ts'
import type { RadarDatabase } from './database'

const BCRA_QUOTES_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones'
const maxResponseBytes = 128 * 1024
// BCRA reports VND as the ARS value of 1,000 dong; snapshots store ARS per one dong.
const bcraQuoteCurrencyUnitCount: Partial<Record<SalaryCurrency, number>> = { VND: 1000 }
// BCRA's live maestro identifies MXP as PESO MEXICANO; normalize its current-unit quote to ISO MXN.
const bcraQuoteCurrencyAliases: Record<string, { currency: SalaryCurrency; denomination: string }> = {
  MXP: { currency: 'MXN', denomination: 'PESO MEXICANO' },
}

interface BcraQuote {
  codigoMoneda?: unknown
  descripcion?: unknown
  tipoCotizacion?: unknown
}

interface BcraResponse {
  status?: unknown
  results?: {
    fecha?: unknown
    detalle?: unknown
  }
}

export function parseBcraSalaryExchangeRates(value: unknown, fetchedAt = new Date()): SalaryExchangeRateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El BCRA devolvió una respuesta inválida.')
  const response = value as BcraResponse
  if (response.status !== 200 || !response.results || typeof response.results !== 'object') {
    throw new Error('El BCRA no informó cotizaciones disponibles.')
  }

  const asOf = response.results.fecha
  const quotes = response.results.detalle
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf) || !Array.isArray(quotes)) {
    throw new Error('El BCRA devolvió una fecha o una lista de cotizaciones inválida.')
  }

  const arsPerUnit: Partial<Record<SalaryCurrency, number>> = { ARS: 1 }
  for (const quote of quotes as BcraQuote[]) {
    if (typeof quote.codigoMoneda !== 'string') continue
    const hasCanonicalCode = SALARY_CURRENCIES.includes(quote.codigoMoneda as SalaryCurrency)
    let currency: SalaryCurrency
    if (hasCanonicalCode) {
      currency = quote.codigoMoneda as SalaryCurrency
    } else {
      const alias = bcraQuoteCurrencyAliases[quote.codigoMoneda]
      if (!alias || typeof quote.descripcion !== 'string' || quote.descripcion.trim().toUpperCase() !== alias.denomination) continue
      currency = alias.currency
    }
    if (currency === 'ARS') continue
    if (typeof quote.tipoCotizacion === 'number' && Number.isFinite(quote.tipoCotizacion) && quote.tipoCotizacion > 0) {
      // If BCRA later publishes canonical MXN as well, prefer it regardless of row order.
      if (!hasCanonicalCode && arsPerUnit[currency] !== undefined) continue
      arsPerUnit[currency] = quote.tipoCotizacion / (bcraQuoteCurrencyUnitCount[currency] ?? 1)
    }
  }

  const snapshot: SalaryExchangeRateSnapshot = {
    source: 'BCRA',
    asOf,
    fetchedAt: fetchedAt.toISOString(),
    arsPerUnit,
  }
  if (!isSalaryExchangeRateSnapshot(snapshot)) throw new Error('El BCRA no devolvió las cotizaciones mínimas necesarias.')
  if (!isSalaryExchangeRateSnapshotUsable(snapshot, fetchedAt)) throw new Error('La última cotización disponible del BCRA está vencida.')
  return snapshot
}

export async function fetchBcraSalaryExchangeRates(fetcher: typeof fetch = fetch, fetchedAt = new Date()): Promise<SalaryExchangeRateSnapshot> {
  let response: Response
  try {
    response = await fetcher(BCRA_QUOTES_URL, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('No se pudo consultar la API pública de cotizaciones del BCRA.')
  }
  if (!response.ok) throw new Error(`La API del BCRA respondió con estado ${response.status}.`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) throw new Error('La respuesta del BCRA supera el tamaño permitido.')
  if (!response.body) throw new Error('La API del BCRA devolvió una respuesta vacía.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bodyBytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bodyBytes += part.value.byteLength
      if (bodyBytes > maxResponseBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('La respuesta del BCRA supera el tamaño permitido.')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('El BCRA devolvió una respuesta que no es JSON válido.')
  }
  return parseBcraSalaryExchangeRates(parsed, fetchedAt)
}

export async function refreshSalaryExchangeRates(database: RadarDatabase, fetcher: typeof fetch = fetch, now = new Date()) {
  const snapshot = await fetchBcraSalaryExchangeRates(fetcher, now)
  database.saveSalaryExchangeRates(snapshot)
  return snapshot
}

export async function currentSalaryExchangeRates(database: RadarDatabase, fetcher: typeof fetch = fetch, now = new Date()) {
  const cached = database.salaryExchangeRates()
  if (!shouldRefreshSalaryExchangeRates(cached, now)) return cached
  try {
    return await refreshSalaryExchangeRates(database, fetcher, now)
  } catch {
    return isSalaryExchangeRateSnapshotUsable(cached, now) ? cached : null
  }
}
