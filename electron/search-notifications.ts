export type SearchFailureNotice = { title: string; body: string }
export type SearchCompletionCounts = { added: number; errors: number }
export type SearchCompletionNotice = { title: string; body: string }

export type SearchFailureReporter = {
  log: (error: unknown) => void
  isSupported: () => boolean
  show: (notice: SearchFailureNotice, onClick: () => void) => void
  onClick: () => void
  fallback: () => void
}

export const searchFailureNotice: SearchFailureNotice = {
  title: 'No se pudo completar la búsqueda',
  body: 'Abrí Radar Laboral e intentá buscar de nuevo. Si el problema continúa, revisá Fuentes.',
}

export function searchCompletionNotice(counts: SearchCompletionCounts): SearchCompletionNotice | null {
  if (!Number.isInteger(counts.added) || counts.added < 0 || !Number.isInteger(counts.errors) || counts.errors < 0) return null
  if (counts.added === 0 && counts.errors === 0) return null

  const messages: string[] = []
  if (counts.added > 0) {
    messages.push(counts.added === 1 ? 'Se agregó 1 aviso nuevo.' : `Se agregaron ${counts.added} avisos nuevos.`)
  }
  if (counts.errors > 0) {
    messages.push(counts.errors === 1 ? 'Falló la consulta de 1 fuente. Revisá Fuentes.' : `Falló la consulta de ${counts.errors} fuentes. Revisá Fuentes.`)
  }
  return {
    title: counts.added === 0 ? 'Revisá tus fuentes de empleo' : 'Actualización de Radar Laboral',
    body: messages.join(' '),
  }
}

export type SearchCompletionReporter = {
  log: (error: unknown) => void
  isSupported: () => boolean
  show: (notice: SearchCompletionNotice, onClick: () => void, onFailure: (error: unknown) => void) => void
  onClick: () => void
  fallback: (counts: SearchCompletionCounts) => void
}

export function reportSearchCompletion(counts: SearchCompletionCounts, reporter: SearchCompletionReporter): boolean {
  const notice = searchCompletionNotice(counts)
  if (!notice) return false

  const log = (error: unknown) => {
    try {
      reporter.log(error)
    } catch {
      // Logging must not prevent the in-app fallback.
    }
  }
  const showFallback = () => {
    try {
      reporter.fallback(counts)
    } catch (error) {
      log(error)
    }
  }

  let supported = false
  try {
    supported = reporter.isSupported()
  } catch (error) {
    log(error)
  }
  if (!supported) {
    showFallback()
    return false
  }

  try {
    reporter.show(notice, reporter.onClick, (error) => {
      log(error)
      showFallback()
    })
    return true
  } catch (error) {
    log(error)
    showFallback()
    return false
  }
}

export function reportSearchFailure(error: unknown, reporter: SearchFailureReporter) {
  reporter.log(error)
  const showFallback = () => {
    try {
      reporter.fallback()
    } catch (fallbackError) {
      reporter.log(fallbackError)
    }
  }
  let supported = false
  try {
    supported = reporter.isSupported()
  } catch (notificationError) {
    reporter.log(notificationError)
  }
  if (!supported) {
    showFallback()
    return false
  }
  try {
    reporter.show(searchFailureNotice, reporter.onClick)
    return true
  } catch (notificationError) {
    reporter.log(notificationError)
    showFallback()
    return false
  }
}
