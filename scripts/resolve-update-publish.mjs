/**
 * Resuelve el bloque `publish` de electron-builder desde variables de entorno.
 *
 * Uso: `node scripts/resolve-update-publish.mjs` (llamado por `build:publish`).
 *
 * - Lee `RADAR_UPDATE_GITHUB_OWNER` y `RADAR_UPDATE_GITHUB_REPO`.
 * - Si están, reescribe `electron-builder.json5` con ese owner/repo para que
 *   el build genere `latest.yml` apuntando al repo real y publique el Setup.
 * - Si faltan, deja el placeholder `TU_USUARIO` (el build local NO publica
 *   nada; la app instalada queda en estado `disabled` con el mensaje guía).
 * - Exige clave Ed25519 (`ELECTRON_BUILDER_UPDATE_SIGN_KEY` o
 *   `ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE`) cuando hay owner/repo: sin ella,
 *   electron-builder 27 rechaza publicar (`auto-update manifests must be
 *   signed`). Se genera con `npx electron-builder create-update-key`; el PEM
 *   privado queda fuera del repo.
 *
 * No toca ningún otro campo del json5: reemplazo textual acotado a las líneas
 * `"owner"` / `"repo"` dentro del bloque `"publish"`.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const configPath = path.join(root, 'electron-builder.json5')
const owner = (process.env.RADAR_UPDATE_GITHUB_OWNER ?? '').trim()
const repo = (process.env.RADAR_UPDATE_GITHUB_REPO ?? '').trim()

if (!owner || !repo) {
  console.log('resolve-update-publish: sin RADAR_UPDATE_GITHUB_OWNER/RADAR_UPDATE_GITHUB_REPO; se conserva el placeholder (build local sin publicar).')
  process.exit(0)
}

const signKey = process.env.ELECTRON_BUILDER_UPDATE_SIGN_KEY ?? ''
const signKeyFile = process.env.ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE ?? ''
if (!signKey && !signKeyFile) {
  throw new Error('resolve-update-publish: falta clave Ed25519 (ELECTRON_BUILDER_UPDATE_SIGN_KEY o ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE); el publish la exige para firmar latest.yml.')
}

if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repo)) {
  throw new Error('resolve-update-publish: owner/repo con caracteres inválidos (solo letras, números, guion, punto y guion bajo).')
}

let config = fs.readFileSync(configPath, 'utf8')
const publishBlock = /"publish": \{[^}]*\}/u
const match = config.match(publishBlock)
if (!match) throw new Error('resolve-update-publish: no se encontró el bloque "publish" en electron-builder.json5.')
let block = match[0]
block = block.replace(/"owner": "[^"]*"/u, `"owner": "${owner}"`)
block = block.replace(/"repo": "[^"]*"/u, `"repo": "${repo}"`)
config = config.replace(publishBlock, block)
fs.writeFileSync(configPath, config)
console.log(`resolve-update-publish: publish apuntando a ${owner}/${repo}.`)
