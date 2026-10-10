import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { testJsonFeed } from '../electron/search.ts'
import { VERIFIED_SOURCE_POLICIES } from '../src/shared/verified-source-policies.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', manifest.version)
const policy = VERIFIED_SOURCE_POLICIES.find((candidate) => candidate.id === 'lever-anchorage-argentina-json-2026-10-09')
assert.ok(policy, 'Missing reviewed Anchorage Lever policy')

const response = await fetch(policy.url, { signal: AbortSignal.timeout(20_000) })
assert.equal(response.status, 200, 'Anchorage Lever public API must respond successfully')
const raw = await response.text()
assert.ok(Buffer.byteLength(raw) <= 25 * 1024 * 1024, 'Anchorage Lever response exceeded the approved byte limit')
const postings = JSON.parse(raw)
assert.ok(Array.isArray(postings), 'Anchorage Lever response must be a list')
const postingIds = postings.map((posting) => posting?.id)
assert.ok(postingIds.every((id) => typeof id === 'string' && id.length > 0), 'Every Lever posting must have an ID')
assert.equal(new Set(postingIds).size, postingIds.length, 'Anchorage Lever IDs must be unique')

const eligiblePostings = postings.filter((posting) => posting.country === 'AR'
  || (Array.isArray(posting.categories?.allLocations) && posting.categories.allLocations.includes('Argentina')))
assert.ok(eligiblePostings.length > 0, 'Anchorage Lever board has no current Argentina postings')
assert.ok(eligiblePostings.length <= 100, 'Anchorage Lever exceeded the reviewed Argentina posting cap')

const matchingPostings = []
for (const posting of eligiblePostings) {
  const detailResponse = await fetch(`https://api.lever.co/v0/postings/anchorage/${encodeURIComponent(posting.id)}`, { signal: AbortSignal.timeout(20_000) })
  assert.equal(detailResponse.status, 200, `Lever detail failed for posting ${posting.id}`)
  const detailRaw = await detailResponse.text()
  assert.ok(Buffer.byteLength(detailRaw) <= 1024 * 1024, `Lever detail exceeded the 1 MB limit for ${posting.id}`)
  const detail = JSON.parse(detailRaw)
  assert.equal(detail.id, posting.id, 'Lever detail ID must match the listing ID')
  assert.equal(detail.hostedUrl, posting.hostedUrl, 'Lever detail URL must match the original posting URL')
  const allLocations = Array.isArray(detail.categories?.allLocations) ? detail.categories.allLocations : []
  assert.ok(detail.country === 'AR' || allLocations.includes('Argentina'), 'Lever detail must retain a reviewed Argentina signal')
  assert.equal(detail.workplaceType, 'remote', 'Every reviewed Argentina Anchorage posting must be marked remote')
  matchingPostings.push({
    id: detail.id,
    title: detail.text,
    country: detail.country,
    primaryLocation: detail.categories?.location ?? null,
    allLocations,
    workplaceType: detail.workplaceType,
    hostedUrl: detail.hostedUrl,
    inPersonOnboardingRequired: /in-person\s+onboarding.{0,160}no exceptions/iu.test(detail.descriptionPlain ?? ''),
  })
}

assert.ok(matchingPostings.every((posting) => posting.inPersonOnboardingRequired), 'The current job detail should preserve the mandatory in-person onboarding caveat')
const adapterResult = await testJsonFeed(policy.url, {
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
})
assert.equal(adapterResult.itemCount, matchingPostings.length, 'Production adapter should return only the eligible Argentina postings')

const report = {
  projectVersion: manifest.version,
  reviewedOn: policy.reviewedOn,
  capturedAtUtc: new Date().toISOString(),
  companyCareersPage: policy.evidenceUrl,
  companyCareersPageLinksToLever: 'https://jobs.lever.co/anchorage',
  publicLeverBoard: 'https://jobs.lever.co/anchorage?location=Argentina',
  leverPostingApiDocumentation: 'https://github.com/lever/postings-api',
  endpoint: policy.url,
  responseStatus: response.status,
  totalPostings: postings.length,
  uniquePostingIds: new Set(postingIds).size,
  exactArgentinaLocationLabel: 'Argentina',
  matchingPostings,
  productionAdapter: adapterResult,
  generalRemoteWorkCaveat: 'The careers overview says employees may work remotely anywhere in the U.S. or Portugal; each eligible job posting separately lists Argentina among its locations.',
  decision: 'Keep country = AR or the exact allLocations label Argentina. Prioritize that location, retain manual applications, and disclose that the current remote postings require mandatory in-person onboarding.',
}

fs.mkdirSync(release, { recursive: true })
fs.writeFileSync(path.join(release, 'QA-ANCHORAGE-SOURCE.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
