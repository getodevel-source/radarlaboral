const TRACKER_QUERY_KEY =
  /^(?:utm_|_gac_|fb_action_ids(?:$|=)|(?:fbclid|gclid|msclkid|_ga|_gl|gbraid|wbraid|dclid|mc_cid|mc_eid|igshid|ttclid|twclid)(?:$|[=_]))/iu

const TRACKER_FRAGMENT_KEY =
  /^(?:utm_|_gac_|fb_action_ids(?:$|=)|(?:fbclid|gclid|msclkid|_ga|_gl|gbraid|wbraid|dclid|mc_cid|mc_eid|igshid|ttclid|twclid|access_token|id_token|token_type|expires_in)(?:$|[=_]))/iu

function stripFragmentTrackers(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return ''
  // Los fragmentos simples se quitan a propósito: el hash nunca viaja al
  // servidor, así que dos anclas del mismo aviso deben deduplicar igual.
  if (!raw.includes('=')) return ''
  const kept = raw.split('&').filter((entry) => {
    if (!entry) return false
    const separator = entry.indexOf('=')
    const key = separator < 0 ? entry : entry.slice(0, separator)
    if (TRACKER_FRAGMENT_KEY.test(key)) return false
    if (!key.includes('%')) return true
    try {
      return !TRACKER_FRAGMENT_KEY.test(decodeURIComponent(key))
    } catch {
      return true
    }
  })
  return kept.length ? `#${kept.join('&')}` : ''
}

export function normalizeOpportunityUrl(value: string): string {
  const url = new URL(value.trim())
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('El enlace debe ser HTTP o HTTPS y no puede incluir credenciales.')
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKER_QUERY_KEY.test(key)) url.searchParams.delete(key)
  }
  url.hash = stripFragmentTrackers(url.hash)
  return url.toString()
}
