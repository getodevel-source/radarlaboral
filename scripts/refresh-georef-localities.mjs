import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const endpoint = 'https://apis.datos.gob.ar/georef/api/v2.0/localidades-censales?max=5000'
const response = await fetch(endpoint, {
  headers: { accept: 'application/json' },
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
})
if (!response.ok) throw new Error(`Georef respondió HTTP ${response.status}`)

const payload = await response.json()
if (!Array.isArray(payload.localidades_censales) || payload.localidades_censales.length !== payload.total) {
  throw new Error('Georef no confirmó una lista completa de localidades censales.')
}

const localities = payload.localidades_censales.map((locality) => {
  const center = locality.centroide
  const result = {
    id: locality.id,
    name: locality.nombre,
    province: locality.provincia?.nombre,
    department: locality.departamento?.nombre,
    ...(typeof locality.gobierno_local?.nombre === 'string' && locality.gobierno_local.nombre
      ? { governmentLocal: locality.gobierno_local.nombre }
      : {}),
    lat: center?.lat,
    lon: center?.lon,
  }
  if (Object.values(result).some((value) => value === null || value === undefined || value === '')) {
    throw new Error(`Georef devolvió una localidad censal incompleta: ${JSON.stringify(locality)}`)
  }
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) {
    throw new Error(`Georef devolvió un centroide inválido para ${result.name}.`)
  }
  return result
}).sort((left, right) => left.province.localeCompare(right.province, 'es')
  || left.name.localeCompare(right.name, 'es')
  || left.department.localeCompare(right.department, 'es')
  || left.id.localeCompare(right.id))

if (new Set(localities.map((locality) => locality.id)).size !== localities.length) {
  throw new Error('Georef devolvió identificadores censales repetidos.')
}

const output = path.join(root, 'resources', 'georef', 'localities.json')
fs.writeFileSync(output, `${JSON.stringify(localities)}\n`, 'utf8')
console.log(JSON.stringify({ source: endpoint, localities: localities.length, output: path.relative(root, output) }, null, 2))
