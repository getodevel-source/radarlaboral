import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const releaseRoot = path.join(root, 'release')
const evidenceRoot = path.join(root, 'package-evidence')
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const currentReleaseDirectory = path.join(releaseRoot, currentVersion)
const currentSmokeArtifacts = new Set(['QA-PACKAGE.json', 'QA-FORCED-COLORS.png', 'SHA256SUMS.txt'])
const isEvidence = (name) => /^QA-.*\.(?:json|png)$/u.test(name) || name === 'SHA256SUMS.txt'

if (!fs.existsSync(evidenceRoot)) throw new Error(`Tracked package evidence directory does not exist: ${evidenceRoot}`)

const sourceDirectories = fs.existsSync(releaseRoot)
  ? [releaseRoot, ...fs.readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(releaseRoot, entry.name))]
  : []
let refreshedFiles = 0
let refreshedBytes = 0

for (const sourceDirectory of sourceDirectories) {
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !isEvidence(entry.name)) continue
    if (path.resolve(sourceDirectory) === path.resolve(currentReleaseDirectory) && currentSmokeArtifacts.has(entry.name)) continue
    const sourceFile = path.join(sourceDirectory, entry.name)
    const relativePath = path.relative(releaseRoot, sourceFile)
    const evidenceFile = path.join(evidenceRoot, relativePath)
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
    fs.copyFileSync(sourceFile, evidenceFile)
    refreshedFiles++
    refreshedBytes += fs.statSync(sourceFile).size
  }
}

const evidenceFiles = []
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(entryPath)
    else if (entry.isFile() && isEvidence(entry.name)) evidenceFiles.push(entryPath)
  }
}
walk(evidenceRoot)
if (evidenceFiles.length === 0) throw new Error('No linked QA evidence is available for the package')

const evidenceBytes = evidenceFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
console.log(JSON.stringify({ refreshedFiles, refreshedBytes, evidenceFiles: evidenceFiles.length, evidenceBytes }, null, 2))
