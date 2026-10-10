import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fetchBcraSalaryExchangeRates } from '../electron/exchange-rates.ts'
import { SALARY_CURRENCIES } from '../src/shared/types.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', manifest.version)
const BCRA_CURRENCIES_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Maestros/Divisas'
const now = new Date()
let apiResponse
let httpStatus

const snapshot = await fetchBcraSalaryExchangeRates(async (url, options) => {
  const response = await fetch(url, options)
  httpStatus = response.status
  apiResponse = await response.clone().json()
  return response
}, now)

assert.equal(snapshot.source, 'BCRA')
assert.equal(snapshot.arsPerUnit.ARS, 1)
assert.ok(snapshot.arsPerUnit.USD > 0, 'The BCRA snapshot has no positive USD quote')
assert.ok(snapshot.arsPerUnit.VND > 0, 'The BCRA snapshot has no positive VND quote')
assert.ok(apiResponse?.results?.detalle && Array.isArray(apiResponse.results.detalle), 'The BCRA response has no quote list')

const quotes = apiResponse.results.detalle
const publishedVnd = quotes.find((quote) => quote.codigoMoneda === 'VND')
assert.ok(Number.isFinite(publishedVnd?.tipoCotizacion) && publishedVnd.tipoCotizacion > 0, 'The BCRA has no positive VND-per-thousand quote')
assert.equal(snapshot.arsPerUnit.VND, publishedVnd.tipoCotizacion / 1000, 'Radar did not normalize the BCRA VND quote to ARS per dong')

const currenciesResponse = await fetch(BCRA_CURRENCIES_URL, {
  headers: { accept: 'application/json' },
  redirect: 'error',
  signal: AbortSignal.timeout(10_000),
})
assert.equal(currenciesResponse.status, 200, 'The BCRA currency master request failed')
const currenciesBody = await currenciesResponse.json()
assert.equal(currenciesBody?.status, 200, 'The BCRA currency master did not report success')
const publishedMxpCurrency = currenciesBody.results?.find((currency) => currency.codigo === 'MXP')
assert.equal(publishedMxpCurrency?.denominacion, 'PESO MEXICANO', 'The BCRA maestro no longer identifies MXP as PESO MEXICANO')
const publishedMxp = quotes.find((quote) => quote.codigoMoneda === 'MXP')
assert.ok(Number.isFinite(publishedMxp?.tipoCotizacion) && publishedMxp.tipoCotizacion > 0, 'The BCRA has no positive MXP quote')
assert.equal(publishedMxp.descripcion, publishedMxpCurrency.denominacion, 'The BCRA quote description does not match its currency master')
assert.equal(snapshot.arsPerUnit.MXN, publishedMxp.tipoCotizacion, 'Radar did not map the current BCRA MXP quote one-to-one to ISO MXN')

const quoteDay = Date.parse(`${snapshot.asOf}T00:00:00.000Z`)
const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
const ageDays = Math.floor((currentDay - quoteDay) / (24 * 60 * 60 * 1000))
assert.ok(ageDays >= 0 && ageDays <= 7, `The BCRA quote date is outside the seven-day window: ${snapshot.asOf}`)

const availableCurrencies = Object.keys(snapshot.arsPerUnit).sort()
const missingCurrencies = SALARY_CURRENCIES.filter((currency) => snapshot.arsPerUnit[currency] === undefined)
const positiveSupportedQuotes = quotes.filter((quote) =>
  SALARY_CURRENCIES.includes(quote.codigoMoneda)
  && quote.codigoMoneda !== 'ARS'
  && Number.isFinite(quote.tipoCotizacion)
  && quote.tipoCotizacion > 0,
).map((quote) => quote.codigoMoneda).sort()

const report = {
  projectVersion: manifest.version,
  testedAtUtc: now.toISOString(),
  endpoint: 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones',
  method: 'Production BCRA fetcher and parser; validates VND unit normalization and verifies MXP denomination against the live BCRA currency master before mapping it to ISO MXN.',
  httpStatus,
  source: snapshot.source,
  quoteDate: snapshot.asOf,
  quoteAgeDays: ageDays,
  availableCurrencies,
  availableNonArsRateCount: availableCurrencies.length - 1,
  missingCurrencies,
  positiveSupportedQuoteCount: positiveSupportedQuotes.length,
  positiveSupportedQuotes,
  normalizedNonArsRateCount: availableCurrencies.length - 1,
  usdArsPerUnit: snapshot.arsPerUnit.USD,
  vndPublishedArsPerThousandDong: publishedVnd.tipoCotizacion,
  vndNormalizedArsPerDong: snapshot.arsPerUnit.VND,
  vndNormalizationConfirmed: true,
  mxpDenomination: publishedMxpCurrency.denominacion,
  mxpPublishedArsPerUnit: Number.isFinite(publishedMxp?.tipoCotizacion) ? publishedMxp.tipoCotizacion : null,
  mxnRate: snapshot.arsPerUnit.MXN,
  mxpMappedToMxnOneToOne: true,
  note: 'BCRA uses MXP for its live PESO MEXICANO quote; Radar stores that current-unit quote under ISO MXN. Salary conversion remains optional per profile, and currencies missing from the snapshot are not converted.',
}

fs.mkdirSync(release, { recursive: true })
fs.writeFileSync(path.join(release, 'QA-BCRA-EXCHANGE-RATES.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
