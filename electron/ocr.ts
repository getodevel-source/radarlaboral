import path from 'node:path'
import { createWorker, PSM } from 'tesseract.js'

const maxOcrImageBytes = 8 * 1024 * 1024
type OcrWorker = Awaited<ReturnType<typeof createWorker>>

let workerPromise: Promise<OcrWorker> | null = null
let ocrQueue: Promise<string> = Promise.resolve('')

function localLanguagePath() {
  const electronResources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return electronResources
    ? path.join(electronResources, 'ocr')
    : path.join(process.cwd(), 'resources', 'ocr')
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(['spa', 'eng'], 1, {
      langPath: localLanguagePath(),
      cacheMethod: 'none',
    }).then(async (worker) => {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
        return worker
      } catch (error) {
        await worker.terminate()
        throw error
      }
    })
    void workerPromise.catch(() => { workerPromise = null })
  }
  return workerPromise
}

export async function recognizeOcrImage(input: unknown): Promise<string> {
  if (!(input instanceof Uint8Array) || input.byteLength < 8 || input.byteLength > maxOcrImageBytes) {
    throw new Error('La imagen de OCR debe ser PNG y no superar los 8 MB.')
  }
  if (input[0] !== 0x89 || input[1] !== 0x50 || input[2] !== 0x4e || input[3] !== 0x47
    || input[4] !== 0x0d || input[5] !== 0x0a || input[6] !== 0x1a || input[7] !== 0x0a) {
    throw new Error('La página para OCR no tiene formato PNG válido.')
  }
  const image = Buffer.from(input)
  // tesseract workers are not safe for concurrent recognize() calls and a
  // hung page would otherwise block every future OCR request, so serialize
  // through a chain and bound each page with a timeout. A failure must not
  // break the chain for later pages.
  const pending = ocrQueue.catch(() => '').then(async () => {
    const worker = await getWorker()
    const result = await Promise.race([
      worker.recognize(image),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('El reconocimiento de la página tardó demasiado.')), 120_000)),
    ])
    return result.data.text.trim().slice(0, 100_000)
  })
  ocrQueue = pending.catch(() => '')
  return pending
}

export async function terminateOcrWorker() {
  const current = workerPromise
  workerPromise = null
  if (!current) return
  try {
    await (await current).terminate()
  } catch {
    // The worker may already have exited during application shutdown.
  }
}
