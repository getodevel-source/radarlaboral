const workplaceLabels: Record<string, string> = {
  remote: 'remoto',
  hybrid: 'híbrido',
  'on-site': 'presencial',
}

export const LEVER_PAGE_SIZE = 100
export const LEVER_MAX_POSTINGS = 2000
export const LEVER_MAX_ARGENTINA_POSTINGS = 100

function leverPostingIdentifier(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Lever devolvió un aviso sin formato reconocido; no se importó la fuente.')
  }
  const posting = value as Record<string, unknown>
  const identifier = typeof posting.id === 'string' && posting.id.trim()
    ? posting.id.trim()
    : typeof posting.hostedUrl === 'string' && posting.hostedUrl.trim()
      ? posting.hostedUrl.trim()
      : ''
  if (!identifier) throw new Error('Lever devolvió un aviso sin identificador; no se importó la fuente.')
  return identifier
}

/** Reads every Lever page within a bounded record count and rejects unstable or malformed pagination. */
export async function fetchAllLeverPostings(fetchPage: (skip: number) => Promise<unknown>, maximum = LEVER_MAX_POSTINGS): Promise<unknown[]> {
  if (!Number.isInteger(maximum) || maximum < LEVER_PAGE_SIZE || maximum > LEVER_MAX_POSTINGS || maximum % LEVER_PAGE_SIZE !== 0) {
    throw new Error('El límite de paginación de Lever no es válido.')
  }

  const postings: unknown[] = []
  const identifiers = new Set<string>()
  let firstPageIdentifiers: string[] = []
  let paged = false
  const verifyFirstPage = async () => {
    if (!paged) return postings
    const page = await fetchPage(0)
    if (!Array.isArray(page) || page.length > LEVER_PAGE_SIZE) {
      throw new Error('Lever cambió o truncó la lista durante la paginación; no se importó la fuente.')
    }
    const currentIdentifiers = page.map(leverPostingIdentifier)
    if (currentIdentifiers.length !== firstPageIdentifiers.length || currentIdentifiers.some((identifier, index) => identifier !== firstPageIdentifiers[index])) {
      throw new Error('Lever cambió la primera página durante la paginación; no se importó la fuente.')
    }
    return postings
  }
  for (let skip = 0; skip <= maximum; skip += LEVER_PAGE_SIZE) {
    if (skip > 0) paged = true
    const page = await fetchPage(skip)
    if (!Array.isArray(page) || page.length > LEVER_PAGE_SIZE) {
      throw new Error('Lever devolvió una página con un formato o tamaño no reconocido; no se importó la fuente.')
    }
    if (skip === maximum) {
      if (page.length > 0) throw new Error(`Lever supera el límite de ${maximum} avisos y no se importó la fuente.`)
      return verifyFirstPage()
    }

    for (const value of page) {
      const identifier = leverPostingIdentifier(value)
      if (identifiers.has(identifier)) throw new Error('Lever repitió avisos entre páginas; no se importó la fuente.')
      identifiers.add(identifier)
    }
    if (skip === 0) firstPageIdentifiers = page.map(leverPostingIdentifier)
    postings.push(...page)
    if (page.length < LEVER_PAGE_SIZE) return verifyFirstPage()
  }
  throw new Error(`Lever no confirmó el fin de la paginación dentro del límite de ${maximum} avisos.`)
}

function assertLeverPostingUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return
  const rawUrl = value.trim()
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Lever devolvió un aviso con un enlace inválido.')
  }
  const authority = rawUrl.slice(rawUrl.indexOf('://') + 3).split(/[/?#]/u, 1)[0]
  if (authority.includes('@') || url.protocol !== 'https:' || url.username || url.password
    || url.hostname !== 'jobs.lever.co' || url.port || url.search || url.hash) {
    throw new Error('Lever devolvió un aviso con un enlace que no pertenece a su tablero público.')
  }
}

function normalizeLeverLocationLabel(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Copies Lever's structured workplace type into the description used by Radar's matching rules. */
export function leverArgentinaPayload(
  payload: unknown,
  maxArgentinaPostings = LEVER_MAX_ARGENTINA_POSTINGS,
  argentinaLocationLabels?: readonly string[],
): unknown {
  if (!Array.isArray(payload)) throw new Error('Lever devolvió una lista de avisos con un formato no reconocido.')
  if (!Number.isSafeInteger(maxArgentinaPostings) || maxArgentinaPostings < 1 || maxArgentinaPostings > LEVER_MAX_POSTINGS) {
    throw new Error(`El límite de avisos argentinos de Lever debe estar entre 1 y ${LEVER_MAX_POSTINGS}.`)
  }

  const normalizedApprovedLabels = (argentinaLocationLabels ?? [])
    .map((label) => normalizeLeverLocationLabel(label))
    .filter((label) => label.length > 0)
  const eligiblePostings = argentinaLocationLabels?.length
    ? payload.filter((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const posting = value as Record<string, unknown>
      if (typeof posting.country === 'string' && posting.country.trim().toLocaleLowerCase() === 'ar') return true
      const categories = posting.categories && typeof posting.categories === 'object' && !Array.isArray(posting.categories)
        ? posting.categories as Record<string, unknown>
        : null
      const locations = Array.isArray(categories?.allLocations)
        ? categories.allLocations.filter((location): location is string => typeof location === 'string')
        : []
      return locations.some((location) => normalizedApprovedLabels.includes(normalizeLeverLocationLabel(location)))
    })
    : payload
  const argentinaCount = argentinaLocationLabels?.length
    ? eligiblePostings.length
    : payload.filter((value) => value && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).country === 'string'
      && ((value as Record<string, unknown>).country as string).trim().toLocaleLowerCase() === 'ar').length
  if (argentinaCount > maxArgentinaPostings) {
    throw new Error(`Lever devolvió más de ${maxArgentinaPostings} avisos argentinos; no se importó la fuente.`)
  }

  return eligiblePostings.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    let posting = value as Record<string, unknown>
    assertLeverPostingUrl(posting.hostedUrl)
    if (argentinaLocationLabels?.length) {
      const categories = posting.categories && typeof posting.categories === 'object' && !Array.isArray(posting.categories)
        ? posting.categories as Record<string, unknown>
        : null
      const locations = Array.isArray(categories?.allLocations)
        ? categories.allLocations.filter((location): location is string => typeof location === 'string')
        : []
      const matchingLocation = locations.find((location) => normalizedApprovedLabels.includes(normalizeLeverLocationLabel(location)))
      if (categories && matchingLocation) {
        posting = {
          ...posting,
          categories: {
            ...categories,
            location: matchingLocation,
            allLocations: [matchingLocation, ...locations.filter((location) => location !== matchingLocation)],
          },
        }
      }
    }
    const workplaceType = typeof posting.workplaceType === 'string' ? posting.workplaceType.toLowerCase() : ''
    const workplaceLabel = workplaceLabels[workplaceType]
    if (!workplaceLabel) return posting

    const prefix = `Modalidad de trabajo: ${workplaceLabel}.`
    const description = typeof posting.descriptionPlain === 'string' ? posting.descriptionPlain.trim() : ''
    if (description.toLowerCase().startsWith(prefix.toLowerCase())) return posting
    return { ...posting, descriptionPlain: description ? `${prefix}\n\n${description}` : prefix }
  })
}
