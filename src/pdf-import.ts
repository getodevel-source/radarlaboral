export function copyPdfBytesForWorker(bytes: Uint8Array): Uint8Array {
  return bytes.slice()
}
