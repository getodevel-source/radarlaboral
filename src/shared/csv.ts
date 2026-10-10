import type { CsvSourceConfig } from './types'

export function decodeCsvBytes(input: Uint8Array): { contents: string; encoding: string } {
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return { contents: new TextDecoder('utf-16le').decode(input.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    return { contents: new TextDecoder('utf-16be').decode(input.subarray(2)), encoding: 'UTF-16BE' }
  }

  try {
    return { contents: new TextDecoder('utf-8', { fatal: true }).decode(input), encoding: 'UTF-8' }
  } catch {
    return { contents: new TextDecoder('windows-1252').decode(input), encoding: 'Windows-1252' }
  }
}

export function parseCsvRows(input: string, delimiter: CsvSourceConfig['delimiter']): string[][] {
  const text = input.replace(/^\uFEFF/u, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false

  const pushField = () => {
    row.push(field)
    field = ''
    closedQuote = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
    if (rows.length > 1001) throw new Error('El CSV supera el límite de 1000 filas de avisos.')
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        closedQuote = true
      } else {
        field += character
      }
      continue
    }

    if (closedQuote && character !== delimiter && character !== '\n' && character !== '\r' && !/[\t ]/u.test(character)) {
      throw new Error('El CSV tiene texto después del cierre de un campo entre comillas.')
    }
    if (character === delimiter) {
      pushField()
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      pushRow()
    } else if (character === '"') {
      if (field.length || closedQuote) throw new Error('El CSV tiene una comilla fuera de lugar.')
      quoted = true
    } else if (!closedQuote || !/[\t ]/u.test(character)) {
      field += character
    }
  }

  if (quoted) throw new Error('El CSV termina con un campo entre comillas sin cerrar.')
  if (field.length || row.length || closedQuote) pushRow()
  return rows
}

export function detectCsvDelimiter(input: string): CsvSourceConfig['delimiter'] {
  const delimiters: CsvSourceConfig['delimiter'][] = [',', ';', '\t']
  let best = delimiters[0]
  let bestColumns = 0
  for (const delimiter of delimiters) {
    try {
      const columns = parseCsvRows(input, delimiter)[0]?.length ?? 0
      if (columns > bestColumns) {
        best = delimiter
        bestColumns = columns
      }
    } catch {
      // The preview reports the actual parse error after the user picks a separator.
    }
  }
  return best
}
