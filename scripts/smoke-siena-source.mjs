import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { testJsonFeed } from '../electron/search.ts'
import { ashbyArgentinaJsonConfig, ashbyArgentinaPayload } from '../src/shared/ashby.ts'
import { VERIFIED_SOURCE_POLICIES } from '../src/shared/verified-source-policies.ts'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', manifest.version)
const policy = VERIFIED_SOURCE_POLICIES.find((candidate) => candidate.id === 'ashby-siena-argentina-json-2026-10-09')
assert.ok(policy, 'Missing reviewed Siena Ashby policy')

const careersResponse = await fetch(policy.evidenceUrl, { signal: AbortSignal.timeout(20_000) })
assert.equal(careersResponse.status, 200, 'Siena official careers page must respond successfully')
const careersHtml = await careersResponse.text()
assert.ok(Buffer.byteLength(careersHtml) <= 2 * 1024 * 1024, 'Siena careers page exceeded the 2 MB review limit')
assert.match(careersHtml, /jobs\.ashbyhq\.com\/siena/iu, 'Siena careers page must link to the reviewed Ashby board')

const response = await fetch(policy.url, { signal: AbortSignal.timeout(20_000) })
assert.equal(response.status, 200, 'Siena Ashby public API must respond successfully')
const raw = await response.text()
assert.ok(Buffer.byteLength(raw) <= 25 * 1024 * 1024, 'Siena Ashby response exceeded the 25 MB review limit')
const postingPayload = JSON.parse(raw)
assert.equal(postingPayload.apiVersion, '1', 'Siena Ashby API version must be recognized')
assert.ok(Array.isArray(postingPayload.jobs), 'Siena Ashby API must return a job list')
assert.ok(postingPayload.jobs.length <= 250, 'Siena Ashby board exceeded the production adapter limit')

const postingIds = postingPayload.jobs.map((posting) => posting?.id)
assert.ok(postingIds.every((id) => typeof id === 'string' && id.length > 0), 'Every Siena posting must have an ID')
assert.equal(new Set(postingIds).size, postingIds.length, 'Siena Ashby posting IDs must be unique')
assert.ok(postingPayload.jobs.every((posting) => typeof posting.isListed === 'boolean'), 'Siena must state whether every posting is listed')

const mappedJobs = ashbyArgentinaPayload(postingPayload, policy.ashbyBoardToken, policy.ashbyCompanyName).jobs
assert.ok(mappedJobs.length > 0, 'Siena Ashby board has no current Argentina postings')
const matchingPostings = mappedJobs.map((job) => {
  const id = new URL(job.jobUrl).pathname.split('/').filter(Boolean).at(-1)
  const listing = postingPayload.jobs.find((candidate) => candidate.id === id)
  assert.ok(listing?.isListed, 'Every mapped Siena posting must currently be listed')
  assert.equal(job.company, 'Siena AI')
  return {
    id,
    title: job.title,
    workplaceType: listing.workplaceType ?? null,
    primaryLocation: listing.location ?? null,
    secondaryLocations: (listing.secondaryLocations ?? []).map((location) => ({
      location: location.location,
      country: location.address?.postalAddress?.addressCountry ?? location.address?.addressCountry ?? null,
    })),
    displayedLocations: job.location,
    jobUrl: job.jobUrl,
  }
})

const adapterResult = await testJsonFeed(policy.url, ashbyArgentinaJsonConfig)
assert.equal(adapterResult.itemCount, matchingPostings.length, 'Production adapter should return every mapped Argentina posting')
assert.deepEqual(adapterResult.sampleTitles, matchingPostings.slice(0, 3).map((posting) => posting.title))

const report = {
  projectVersion: manifest.version,
  reviewedOn: policy.reviewedOn,
  capturedAtUtc: new Date().toISOString(),
  companyCareersPage: policy.evidenceUrl,
  careersPageStatus: careersResponse.status,
  careersPageLinksToSienaAshby: true,
  careersPageEvidence: 'The official page lists Argentina roles and describes a globally remote team.',
  publicAshbyBoard: 'https://jobs.ashbyhq.com/siena',
  publicAshbyPostingApiDocumentation: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
  endpoint: policy.url,
  responseStatus: response.status,
  apiVersion: postingPayload.apiVersion,
  totalPostings: postingPayload.jobs.length,
  listedPostings: postingPayload.jobs.filter((posting) => posting.isListed).length,
  uniquePostingIds: new Set(postingIds).size,
  matchingPostings,
  productionAdapter: adapterResult,
  locationCaveat: 'Product Specialist has primary location Remote - Europe and Buenos Aires as an explicit secondary location. Radar preserves both and puts Buenos Aires first; confirm location eligibility on the original posting before applying.',
  decision: 'Keep only listed postings whose primary or secondary structured location enables Argentina. Preserve the complete location list, attribute jobs to Siena AI, and leave applications manual.',
}

fs.mkdirSync(release, { recursive: true })
fs.writeFileSync(path.join(release, 'QA-SIENA-SOURCE.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
