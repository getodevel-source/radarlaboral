import { SALARY_CURRENCIES } from '../src/shared/types.ts'
import type { SalaryCurrency, SalaryExchangeRateSnapshot } from '../src/shared/types.ts'
import { isSalaryExchangeRateSnapshotUsable } from '../src/shared/salary-exchange-rates.ts'
export type { SalaryCurrency } from '../src/shared/types.ts'

export interface MonthlySalary {
  currency: SalaryCurrency
  lowerBound: number
  upperBound: number
  sourcePeriod: SalaryPeriod
}

export interface SalaryWorkload {
  workDaysPerWeek?: number | null
  workHoursPerWeek?: number | null
}

export function convertMonthlySalaryCurrency(
  salary: MonthlySalary,
  targetCurrency: SalaryCurrency,
  snapshot: SalaryExchangeRateSnapshot | null,
  now = new Date(),
) {
  if (!snapshot || !isSalaryExchangeRateSnapshotUsable(snapshot, now)) return null
  const sourceArsPerUnit = snapshot.arsPerUnit[salary.currency]
  const targetArsPerUnit = snapshot.arsPerUnit[targetCurrency]
  if (!sourceArsPerUnit || !targetArsPerUnit) return null
  const rate = sourceArsPerUnit / targetArsPerUnit
  const roundMoney = (amount: number) => Math.round((amount * rate + Number.EPSILON) * 100) / 100
  return {
    lowerBound: roundMoney(salary.lowerBound),
    upperBound: roundMoney(salary.upperBound),
    rate,
  }
}

export type SalaryPeriod = 'monthly' | 'annual' | 'weekly' | 'daily' | 'hourly'

const currencyAliases: Record<SalaryCurrency, string[]> = {
  ARS: ['peso argentino', 'pesos argentinos', 'argentine peso', 'argentine pesos'],
  USD: ['u$s', 'us$', 'us dollar', 'us dollars', 'dolar estadounidense', 'dolares estadounidenses', 'dolar americano', 'dolares americanos'],
  EUR: ['euro', 'euros'],
  GBP: ['pound sterling', 'pounds sterling', 'british pound', 'british pounds', 'libra esterlina', 'libras esterlinas'],
  BRL: ['real brasileiro', 'reais brasileiros', 'real brasileno', 'reales brasilenos', 'brazilian real', 'brazilian reais'],
  CLP: ['peso chileno', 'pesos chilenos', 'chilean peso', 'chilean pesos'],
  UYU: ['peso uruguayo', 'pesos uruguayos', 'uruguayan peso', 'uruguayan pesos'],
  PEN: ['sol peruano', 'soles peruanos', 'peruvian sol', 'peruvian soles'],
  COP: ['peso colombiano', 'pesos colombianos', 'colombian peso', 'colombian pesos'],
  MXN: ['peso mexicano', 'pesos mexicanos', 'mexican peso', 'mexican pesos'],
  CAD: ['canadian dollar', 'canadian dollars', 'dolar canadiense', 'dolares canadienses'],
  AUD: ['australian dollar', 'australian dollars', 'dolar australiano', 'dolares australianos'],
  JPY: ['yen japones', 'yen japonés', 'japanese yen', 'yen'],
  CHF: ['swiss franc', 'swiss francs', 'franco suizo', 'francos suizos'],
  AWG: ['aruban florin', 'aruban florins', 'florin arubano', 'florines arubanos'],
  BOB: ['boliviano', 'bolivianos', 'bolivian bolivianos'],
  CNH: ['offshore yuan', 'offshore renminbi', 'yuan chino offshore', 'renminbi offshore'],
  CNY: ['chinese yuan', 'chinese renminbi', 'yuan chino', 'yuanes chinos', 'renminbi chino'],
  CZK: ['czech koruna', 'czech korunas', 'corona checa', 'coronas checas'],
  DKK: ['danish krone', 'danish kroner', 'corona danesa', 'coronas danesas'],
  HKD: ['hong kong dollar', 'hong kong dollars', 'dolar de hong kong', 'dolares de hong kong'],
  ILS: ['new israeli shekel', 'new israeli shekels', 'israeli new shekel', 'shekel israeli', 'shekels israelies'],
  INR: ['indian rupee', 'indian rupees', 'rupia india', 'rupias indias'],
  NIO: ['nicaraguan cordoba', 'nicaraguan cordobas', 'cordoba nicaraguense', 'cordobas nicaraguenses'],
  NOK: ['norwegian krone', 'norwegian kroner', 'corona noruega', 'coronas noruegas'],
  NZD: ['new zealand dollar', 'new zealand dollars', 'dolar neozelandes', 'dolares neozelandeses'],
  PYG: ['paraguayan guarani', 'paraguayan guaranies', 'guarani paraguayo', 'guaranies paraguayos'],
  RSD: ['serbian dinar', 'serbian dinars', 'dinar serbio', 'dinares serbios'],
  RUB: ['russian ruble', 'russian rubles', 'russian rouble', 'russian roubles', 'rublo ruso', 'rublos rusos'],
  SEK: ['swedish krona', 'swedish kronor', 'corona sueca', 'coronas suecas'],
  SGD: ['singapore dollar', 'singapore dollars', 'dolar de singapur', 'dolares de singapur'],
  TRY: ['turkish lira', 'turkish liras', 'lira turca', 'liras turcas'],
  VND: ['vietnamese dong', 'dong vietnamita', 'dongs vietnamitas'],
  ZAR: ['south african rand', 'south african rands', 'rand sudafricano', 'rands sudafricanos'],
}

const currencyCodes = new Set<string>(SALARY_CURRENCIES)

function hasCurrencyCode(value: string, code: SalaryCurrency) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${code.toLowerCase()}(?:$|[^\\p{L}\\p{N}])`, 'u').test(value)
}

function currencyFromText(value: string): SalaryCurrency | null {
  const normalized = normalize(value)
  const genericDollarAliases = new Set(['dollar', 'dollars', 'dolar', 'dolares'])
  const matches = SALARY_CURRENCIES.filter((code) => {
    const aliases = code === 'USD'
      ? currencyAliases[code].filter((alias) => !genericDollarAliases.has(alias))
      : currencyAliases[code]
    return hasCurrencyCode(normalized, code) || aliases.some((alias) => normalized.includes(normalize(alias)))
  })
  const hasUnqualifiedDollar = [...genericDollarAliases].some((alias) => normalized.includes(alias))
  const hasOtherDollarCurrency = ['CAD', 'AUD', 'HKD', 'NZD', 'SGD'].some((code) => matches.includes(code as SalaryCurrency))
  if (hasUnqualifiedDollar && !hasOtherDollarCurrency && !matches.includes('USD')) matches.push('USD')
  return matches.length === 1 ? matches[0] : null
}

/** Resolves a three-letter code or an unambiguous currency name without guessing from symbols such as `$`. */
export function normalizeSalaryCurrency(raw: string): SalaryCurrency | null {
  const normalized = normalize(raw).trim()
  const code = normalized.toUpperCase()
  if (currencyCodes.has(code)) return code as SalaryCurrency
  return SALARY_CURRENCIES.find((currency) =>
    currencyAliases[currency].some((alias) => normalized === normalize(alias)),
  ) ?? null
}

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()

const salaryNumberPattern = String.raw`(?:\d{1,3}(?:[.,\s\u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`

function parseAmount(value: string) {
  const compact = value.replace(/[\s\u00a0]/gu, '')
  const separators = [...compact.matchAll(/[.,]/gu)].map((match) => match.index!)
  if (!separators.length) return Number(compact)

  const lastSeparator = separators[separators.length - 1]
  const decimalDigits = compact.length - lastSeparator - 1
  const hasBothSeparators = compact.includes('.') && compact.includes(',')
  const isDecimal = decimalDigits > 0 && decimalDigits <= 2 && (hasBothSeparators || decimalDigits !== 3)
  if (!isDecimal) return Number(compact.replace(/[.,]/gu, ''))

  const integer = compact.slice(0, lastSeparator).replace(/[.,]/gu, '')
  const decimals = compact.slice(lastSeparator + 1)
  return Number(`${integer}.${decimals}`)
}

function currencyMarkerRanges(value: string, currency: SalaryCurrency) {
  const markers = new Set([currency.toLowerCase(), ...currencyAliases[currency].map(normalize)])
  const ranges: Array<{ start: number; end: number }> = []
  for (const marker of markers) {
    let start = value.indexOf(marker)
    while (start !== -1) {
      const before = value[start - 1] ?? ''
      const after = value[start + marker.length] ?? ''
      const isWord = (character: string) => /[\p{L}\p{N}]/u.test(character)
      if ((!before || !isWord(before)) && (!after || !isWord(after))) {
        ranges.push({ start, end: start + marker.length })
      }
      start = value.indexOf(marker, start + marker.length)
    }
  }
  return ranges
}

function salaryBounds(value: string, currency: SalaryCurrency): { lowerBound: number; upperBound: number } | null {
  const amountPattern = new RegExp(`${salaryNumberPattern}(?:\\s*[kKmM](?![\\p{L}\\p{N}]))?`, 'giu')
  const amounts = [...value.matchAll(amountPattern)].flatMap((match) => {
    const amount = parseSalaryAmount(match[0])
    return amount === null || match.index === undefined
      ? []
      : [{ amount, start: match.index, end: match.index + match[0].length }]
  })
  if (!amounts.length) return null

  const ranges: Array<[number, number]> = []
  for (let index = 0; index < amounts.length - 1; index += 1) {
    const gap = value.slice(amounts[index].end, amounts[index + 1].start)
    if (/^\s*(?:[-–—]|to|a|hasta)\s*$/u.test(gap)) ranges.push([index, index + 1])
  }
  if (ranges.length > 1) return null
  if (ranges.length === 1) {
    const [firstIndex, secondIndex] = ranges[0]
    const first = amounts[firstIndex].amount
    const second = amounts[secondIndex].amount
    return { lowerBound: Math.min(first, second), upperBound: Math.max(first, second) }
  }

  const currencies = currencyMarkerRanges(value, currency)
  if (!currencies.length) return null
  const ranked = amounts.map((amount) => ({
    amount: amount.amount,
    distance: Math.min(...currencies.map((marker) => amount.end <= marker.start
      ? marker.start - amount.end
      : amount.start >= marker.end
        ? amount.start - marker.end
        : 0)),
  })).sort((left, right) => left.distance - right.distance)
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return null
  return { lowerBound: ranked[0].amount, upperBound: ranked[0].amount }
}

/** Parses one explicitly mapped amount with common separators and optional K/M magnitude suffixes. */
export function parseSalaryAmount(raw: string): number | null {
  const value = raw.trim()
  const match = value.length <= 40
    ? value.match(new RegExp(`^(${salaryNumberPattern})\\s*([kKmM])?$`, 'u'))
    : null
  if (!match) return null
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1
  const amount = parseAmount(match[1]) * multiplier
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) return null
  return amount
}

/** Resolves only known period labels; unknown source values stay incomparable. */
export function normalizeSalaryPeriod(raw: string): SalaryPeriod | null {
  const value = normalize(raw).replace(/[._-]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (['month', 'months', 'monthly', 'per month', 'per mo', 'every month', 'month to month', 'mes', 'meses', 'mensal', 'mensais', 'mensalmente', 'mensual', 'mensuales', 'mensualmente', 'por mes', 'al mes', 'mes a mes', 'p/m', 'p1m'].includes(value)) return 'monthly'
  if (['year', 'years', 'annual', 'annually', 'yearly', 'per year', 'per annum', 'ano', 'anos', 'anual', 'anuales', 'por ano', 'al ano', 'p1y'].includes(value)) return 'annual'
  if (['week', 'weeks', 'weekly', 'per week', 'semanal', 'semanales', 'semanalmente', 'por semana', 'por semanas', 'p1w'].includes(value)) return 'weekly'
  if (['day', 'days', 'daily', 'per day', 'diario', 'diaria', 'por dia', 'p1d'].includes(value)) return 'daily'
  if (['hour', 'hours', 'hourly', 'per hour', 'hora', 'horas', 'por hora', 'p1h', 'pt1h'].includes(value)) return 'hourly'
  return null
}

/** Resolves one explicit period from salary text without guessing from schedule mentions. */
export function salaryPeriodFromText(raw: string): SalaryPeriod | null {
  if (!raw.trim() || raw.length > 300) return null
  const normalized = normalize(raw)
  const periods: Array<[SalaryPeriod, RegExp]> = [
    ['monthly', /\b(mensual(?:es|mente)?|mensal(?:mente|es)?|mensais|por\s+mes|al\s+mes|mes\s+a\s+mes|monthly|per\s+month|per\s+mo\.?|every\s+month|months?)\b|\/\s*(?:month|mes)\b/u],
    ['annual', /\b(anual(?:es)?|por\s+ano|al\s+ano|yearly|annually|annual|per\s+(?:year|annum))\b|\/\s*(?:year|yr)\b/u],
    ['weekly', /\b(semanal(?:es|mente)?|por\s+semana|weekly|per\s+week)\b|\/\s*(?:week|wk)\b/u],
    ['daily', /\b(diari(?:o|a|os|as|amente)?|por\s+dias?|al\s+dia|daily|per\s+day|per\s+diem)\b|\/\s*(?:day|d)\b/u],
    ['hourly', /\b(hourly|per\s+hours?|per\s+hrs?|por\s+horas?|cada\s+hora)\b|\/\s*(?:hour|hr|h)\b/u],
  ]
  const matches = periods.filter(([, pattern]) => pattern.test(normalized)).map(([period]) => period)
  return matches.length === 1 ? matches[0] : null
}

/** Returns a monthly equivalent only with an explicit currency, period, and workload when needed. */
export function parseMonthlySalary(raw: string, workload: SalaryWorkload = {}): MonthlySalary | null {
  const sourcePeriod = salaryPeriodFromText(raw)
  if (!sourcePeriod) return null
  const normalized = normalize(raw)
  const days = workload.workDaysPerWeek
  const hours = workload.workHoursPerWeek
  if (sourcePeriod === 'daily' && (!Number.isFinite(days) || days! < 0.5 || days! > 7)) return null
  if (sourcePeriod === 'hourly' && (!Number.isFinite(hours) || hours! < 0.25 || hours! > 168)) return null

  const currency = currencyFromText(normalized)
  if (!currency) return null

  const bounds = salaryBounds(normalized, currency)
  if (bounds === null) return null
  const toMonthlyEquivalent = (amount: number) => {
    if (sourcePeriod === 'annual') return amount / 12
    if (sourcePeriod === 'monthly') return amount
    const weeklyUnits = sourcePeriod === 'weekly'
      ? amount
      : sourcePeriod === 'daily'
        ? amount * days!
        : amount * hours!
    return Math.round((weeklyUnits * 13 / 3 + Number.EPSILON) * 100) / 100
  }
  const lowerBound = toMonthlyEquivalent(bounds.lowerBound)
  const upperBound = toMonthlyEquivalent(bounds.upperBound)
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)
    || lowerBound > Number.MAX_SAFE_INTEGER || upperBound > Number.MAX_SAFE_INTEGER) return null
  return {
    currency,
    lowerBound,
    upperBound,
    sourcePeriod,
  }
}
