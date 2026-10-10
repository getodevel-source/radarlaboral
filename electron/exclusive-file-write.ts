import fs from 'node:fs/promises'

/** Creates a new copy without replacing any existing file. */
export async function writeExclusiveCopy(filePath: string, bytes: Uint8Array): Promise<void> {
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx' })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Ya existe un archivo en esa ubicación. Elegí otro nombre; Radar Laboral no reemplaza archivos existentes.')
    }
    throw error
  }
}
