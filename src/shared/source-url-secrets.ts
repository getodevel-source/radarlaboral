const secretParamKey = /^(?:api[-_]?key|app[-_]?key|access[-_]?token|auth(?:orization)?|client[-_]?secret|password|secret|token|key)$/iu

/** Detecta claves o credenciales en la query o en el fragmento del enlace. */
export function urlCarriesSecret(rawUrl: URL): boolean {
  if ([...rawUrl.searchParams.keys()].some((key) => secretParamKey.test(key))) return true
  const fragment = rawUrl.hash.startsWith('#') ? rawUrl.hash.slice(1) : rawUrl.hash
  if (!fragment) return false
  return fragment.split('&').some((pair) => {
    const rawKey = (pair.split('=')[0] ?? '').trim()
    if (secretParamKey.test(rawKey)) return true
    try {
      return secretParamKey.test(decodeURIComponent(rawKey.replace(/\+/gu, ' ')))
    } catch {
      return false
    }
  })
}
