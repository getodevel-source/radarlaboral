import path from 'node:path'

const userDataFlag = '--radar-user-data-dir'
const testPdfExportFlag = '--radar-test-export-copies'

/** Reads an explicit absolute user-data path before Electron becomes ready. */
export function userDataPathFromArgs(args: string[]): string | null {
  const matchingArgs = args.filter((argument) => argument === userDataFlag || argument.startsWith(`${userDataFlag}=`))
  if (!matchingArgs.length) return null
  if (matchingArgs.length !== 1 || matchingArgs[0] === userDataFlag) {
    throw new Error(`Usá una sola ruta absoluta con ${userDataFlag}=RUTA.`)
  }

  const value = matchingArgs[0].slice(userDataFlag.length + 1).trim()
  const localWindowsDrive = /^[a-z]:[\\/]/iu.test(value)
  if (!value || !path.isAbsolute(value) || (process.platform === 'win32' && !localWindowsDrive)) {
    throw new Error(`La ruta de ${userDataFlag} debe ser absoluta en una unidad local de Windows.`)
  }
  return path.normalize(value)
}

/** Enables deterministic PDF export checks only inside an explicit isolated user-data directory. */
export function testPdfExportDirectoryFromArgs(args: string[], userDataPath: string | null): string | null {
  const matchingArgs = args.filter((argument) => argument === testPdfExportFlag || argument.startsWith(`${testPdfExportFlag}=`))
  if (!matchingArgs.length) return null
  if (matchingArgs.length !== 1 || matchingArgs[0] !== testPdfExportFlag || !userDataPath) {
    throw new Error(`${testPdfExportFlag} requiere una sola vez --radar-user-data-dir=RUTA_ABSOLUTA.`)
  }
  return path.join(path.resolve(userDataPath), 'test-exports')
}
