export function normalizeOpportunityUrl(value: string): string {
  const url = new URL(value.trim())
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('El enlace debe ser HTTP o HTTPS y no puede incluir credenciales.')
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/iu.test(key)) url.searchParams.delete(key)
  }
  return url.toString()
}
