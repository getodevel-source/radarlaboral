import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { testJsonFeed, testRssFeed } from '../electron/search.ts'
import { ashbyArgentinaJsonConfig } from '../src/shared/ashby.ts'
import { greenhouseArgentinaJsonConfig } from '../src/shared/greenhouse.ts'
import { smartRecruitersArgentinaJsonConfig } from '../src/shared/smartrecruiters.ts'
import { VERIFIED_SOURCE_POLICIES } from '../src/shared/verified-source-policies.ts'
import { workableArgentinaJsonConfig } from '../src/shared/workable.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', manifest.version)

const policyById = (id) => {
  const policy = VERIFIED_SOURCE_POLICIES.find((candidate) => candidate.id === id)
  assert.ok(policy, `Missing reviewed source policy: ${id}`)
  return policy
}

const checks = [
  {
    policy: policyById('findjobit-argentina-rss-2026-10-08'),
    fetch: (policy) => testRssFeed(policy.url),
  },
  {
    policy: policyById('lever-despegar-argentina-json-2026-10-08'),
    fetch: (policy) => testJsonFeed(policy.url, {
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
    }),
  },
  {
    policy: policyById('lever-appen-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, {
      itemsPath: '',
      titlePath: '/text',
      urlPath: '/hostedUrl',
      descriptionPath: '/descriptionPlain',
      locationPath: '/categories/location',
      salaryPath: '',
      salaryMinimumPath: '',
      salaryMaximumPath: '',
      salaryCurrencyPath: '',
      salaryPeriodPath: '',
      publishedAtPath: '/createdAt',
      filterPath: '',
      filterValue: '',
    }),
  },
  {
    policy: policyById('lever-anchorage-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, {
      itemsPath: '',
      titlePath: '/text',
      urlPath: '/hostedUrl',
      descriptionPath: '/descriptionPlain',
      locationPath: '/categories/location',
      salaryPath: '',
      salaryMinimumPath: '',
      salaryMaximumPath: '',
      salaryCurrencyPath: '',
      salaryPeriodPath: '',
      publishedAtPath: '/createdAt',
      filterPath: '',
      filterValue: '',
    }),
  },
  {
    policy: policyById('smartrecruiters-coface-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, smartRecruitersArgentinaJsonConfig),
  },
  {
    policy: policyById('greenhouse-cookunity-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, greenhouseArgentinaJsonConfig),
  },
  {
    policy: policyById('ashby-cas-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, ashbyArgentinaJsonConfig),
  },
  {
    policy: policyById('ashby-siena-argentina-json-2026-10-09'),
    fetch: (policy) => testJsonFeed(policy.url, ashbyArgentinaJsonConfig),
  },
  {
    policy: policyById('workable-sur-argentina-json-2026-10-08'),
    fetch: (policy) => testJsonFeed(policy.url, workableArgentinaJsonConfig),
  },
]

const results = []
for (const { policy, fetch } of checks) {
  await delay(350)
  try {
    const result = await fetch(policy)
    assert.ok(Number.isSafeInteger(result.itemCount) && result.itemCount >= 0, `${policy.id} returned an invalid item count`)
    assert.ok(Array.isArray(result.sampleTitles) && result.sampleTitles.every((title) => typeof title === 'string'), `${policy.id} returned invalid sample titles`)
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
  }
}

const report = {
  projectVersion: manifest.version,
  testedAtUtc: new Date().toISOString(),
  method: 'Production RSS/JSON adapter smoke against one exact reviewed policy per connector; sequential requests with a short delay.',
  verifiedPolicies: VERIFIED_SOURCE_POLICIES.length,
  sampleConnectors: checks.length,
  allSamplesResponded: results.every((result) => result.status !== 'error'),
  results,
  note: 'This smoke validates one live example per adapter. It does not revalidate all reviewed boards or replace review of each source policy.',
}

fs.mkdirSync(release, { recursive: true })
fs.writeFileSync(path.join(release, 'QA-LIVE-SOURCES.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (!report.allSamplesResponded) process.exitCode = 1
