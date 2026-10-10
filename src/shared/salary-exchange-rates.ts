import { SALARY_CURRENCIES } from './types.ts'
import type { SalaryExchangeRateSnapshot } from './types.ts'

const maxRateAgeMs = 7 * 24 * 60 * 60 * 1000
const refreshIntervalMs = 12 * 60 * 60 * 1000

export function isSalaryExchangeRateSnapshot(value: unknown): value is SalaryExchangeRateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<SalaryExchangeRateSnapshot>
  if (snapshot.source !== 'BCRA' || typeof snapshot.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.asOf)) return false
  if (!Number.isFinite(Date.parse(snapshot.asOf)) || typeof snapshot.fetchedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.fetchedAt))) return false
  if (!snapshot.arsPerUnit || typeof snapshot.arsPerUnit !== 'object' || Array.isArray(snapshot.arsPerUnit)) return false

  const rates = snapshot.arsPerUnit as Record<string, unknown>
  if (rates.ARS !== 1 || typeof rates.USD !== 'number' || !Number.isFinite(rates.USD) || rates.USD <= 0) return false
  return Object.entries(rates).every(([currency, rate]) =>
    SALARY_CURRENCIES.includes(currency as typeof SALARY_CURRENCIES[number])
    && typeof rate === 'number'
    && Number.isFinite(rate)
    && rate > 0,
  )
}

export function isSalaryExchangeRateSnapshotUsable(snapshot: unknown, now = new Date()): snapshot is SalaryExchangeRateSnapshot {
  if (!isSalaryExchangeRateSnapshot(snapshot)) return false
  const asOf = Date.parse(`${snapshot.asOf}T00:00:00.000Z`)
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return asOf <= currentDay && currentDay - asOf <= maxRateAgeMs
}

export function shouldRefreshSalaryExchangeRates(snapshot: unknown, now = new Date()): boolean {
  if (!isSalaryExchangeRateSnapshotUsable(snapshot, now)) return true
  const fetchedAt = Date.parse(snapshot.fetchedAt)
  return fetchedAt > now.getTime() + 5 * 60 * 1000 || now.getTime() - fetchedAt >= refreshIntervalMs
}
