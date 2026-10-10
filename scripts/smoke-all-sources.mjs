import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { testJsonFeed, testRssFeed } from '../electron/search.ts'
import { ashbyArgentinaJsonConfig } from '../src/shared/ashby.ts'
import { greenhouseArgentinaJsonConfig } from '../src/shared/greenhouse.ts'
import { smartRecruitersArgentinaJsonConfig } from '../src/shared/smartrecruiters.ts'
import { VERIFIED_SOURCE_POLICIES, verifiedSourcePolicyMatchesJsonConfig } from '../src/shared/verified-source-policies.ts'
import { workableArgentinaJsonConfig } from '../src/shared/workable.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', manifest.version)
const policies = [...VERIFIED_SOURCE_POLICIES].sort((left, right) => left.id.localeCompare(right.id))

assert.equal(policies.length, 71, 'Update this full-source smoke when the reviewed policy set changes.')
const leverArgentinaJsonConfig = {
  itemsPath: '',
  titlePath: '/text',
  urlPath: '/hostedUrl',
  descriptionPath: '/descriptionPlain',
  companyPath: '/categories/team',
  locationPath: '/categories/location',
  salaryPath: '',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/createdAt',
  filterPath: '/country',
  filterValue: 'AR',
}
const jsonConfigForPolicy = (policy) => {
  switch (policy.connector) {
    case 'lever-public-jobs':
      return policy.leverArgentinaLocationLabels
        ? { ...leverArgentinaJsonConfig, filterPath: '', filterValue: '' }
        : leverArgentinaJsonConfig
    case 'smartrecruiters-posting-details': return smartRecruitersArgentinaJsonConfig
    case 'greenhouse-public-jobs': return greenhouseArgentinaJsonConfig
    case 'ashby-public-jobs': return ashbyArgentinaJsonConfig
    case 'workable-sur-public-jobs': return workableArgentinaJsonConfig
    default: throw new Error(`No hay un mapeo de producción para ${policy.connector ?? policy.kind}.`)
  }
}
assert.ok(policies.every((policy) => policy.kind !== 'json'
  || verifiedSourcePolicyMatchesJsonConfig(policy, jsonConfigForPolicy(policy))), 'Every JSON policy must use its exact reviewed production mapping.')

const results = []
for (const [index, policy] of policies.entries()) {
  if (index > 0) await delay(350)
  try {
    const result = policy.kind === 'rss'
      ? await testRssFeed(policy.url)
      : await testJsonFeed(policy.url, jsonConfigForPolicy(policy))
    if (!Number.isSafeInteger(result.itemCount) || result.itemCount < 0) {
      throw new Error('El adaptador devolvió un conteo de avisos inválido.')
    }
    if (!Array.isArray(result.sampleTitles) || !result.sampleTitles.every((title) => typeof title === 'string')) {
      throw new Error('El adaptador devolvió títulos de muestra inválidos.')
    }
    results.push({
      policyId: policy.id,
      source: policy.sourceName ?? policy.title,
      connector: policy.connector ?? policy.kind,
      reviewedOn: policy.reviewedOn,
      url: policy.url,
      status: result.itemCount > 0 ? 'ok' : 'valid-empty-response',
      itemCount: result.itemCount,
      sampleTitles: result.sampleTitles,
    })
    process.stdout.write(`[${index + 1}/${policies.length}] ${policy.sourceName ?? policy.title}: ${result.itemCount}\n`)
  } catch (error) {
    results.push({
      policyId: policy.id,
      source: policy.sourceName ?? policy.title,
      connector: policy.connector ?? policy.kind,
      reviewedOn: policy.reviewedOn,
      url: policy.url,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    process.stderr.write(`[${index + 1}/${policies.length}] ${policy.sourceName ?? policy.title}: error\n`)
  }
}

const byConnector = Object.fromEntries(Object.entries(Object.groupBy(results, (result) => result.connector))
  .map(([connector, entries]) => [connector, {
    policies: entries.length,
    passed: entries.filter((entry) => entry.status !== 'error').length,
    emptyResponses: entries.filter((entry) => entry.status === 'valid-empty-response').length,
    mappedPostings: entries.reduce((total, entry) => total + (entry.itemCount ?? 0), 0),
  }]))
const passed = results.filter((result) => result.status !== 'error').length
const report = {
  projectVersion: manifest.version,
  testedAtUtc: new Date().toISOString(),
  method: 'Sequential GET checks for every exact reviewed public policy, through the production RSS/JSON adapter and reviewed field mapping, with a 350 ms delay between policies.',
  reviewedPolicies: policies.length,
  checkedPolicies: results.length,
  passedPolicies: passed,
  failedPolicies: results.length - passed,
  allPoliciesPassed: passed === policies.length,
  byConnector,
  note: 'Counts reflect each production adapter after its reviewed filters. The same vacancy may appear under more than one policy; totals are not globally deduplicated. This check does not replace policy review or guarantee future availability.',
  results,
}

fs.mkdirSync(release, { recursive: true })
fs.writeFileSync(path.join(release, 'QA-LIVE-ALL-SOURCES.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  projectVersion: report.projectVersion,
  testedAtUtc: report.testedAtUtc,
  reviewedPolicies: report.reviewedPolicies,
  passedPolicies: report.passedPolicies,
  failedPolicies: report.failedPolicies,
  byConnector: report.byConnector,
  report: path.relative(root, path.join(release, 'QA-LIVE-ALL-SOURCES.json')),
}, null, 2))
if (!report.allPoliciesPassed) process.exitCode = 1
