import dns from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

const isPublicAddress = (value: string) => {
  try {
    return ipaddr.process(value).range() === 'unicast'
  } catch {
    return false
  }
}

export type ResolvedFeedTarget = { url: URL; address: string; family: 4 | 6 }

// addSource guarda el enlace sin resolver DNS a propósito: el control es el pinning en lectura.
// Toda lectura automática pasa por resolvePublicHttpsTarget + fetchPinnedBytes/fetchPinnedText.
export async function resolvePublicHttpsTarget(rawUrl: string): Promise<ResolvedFeedTarget> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('Por seguridad, las fuentes automáticas deben usar HTTPS.')
  if (url.username || url.password) throw new Error('El enlace no puede incluir credenciales.')
  if (url.port && url.port !== '443') throw new Error('El enlace usa un puerto no permitido; las fuentes automáticas solo admiten el puerto 443.')
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('La fuente debe estar publicada en internet.')
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('No se permiten direcciones de red local.')
    return { url, address: hostname, family: isIP(hostname) as 4 | 6 }
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('La fuente no apunta únicamente a direcciones públicas.')
  }
  const selected = addresses[0]
  return { url, address: selected.address, family: selected.family as 4 | 6 }
}

export function fetchPinnedBytes(target: ResolvedFeedTarget, accept: string, maxBytes = 5 * 1024 * 1024, signal?: AbortSignal) {
  const { url, address, family } = target
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const succeed = (value: Buffer) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = () => {
      request.destroy()
      fail(new Error('La solicitud fue cancelada.'))
    }
    if (signal?.aborted) {
      fail(new Error('La solicitud fue cancelada.'))
      return
    }
    const request = https.request({
      hostname: address,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      family,
      servername: isIP(hostname) ? undefined : hostname,
      headers: {
        host: url.host,
        accept,
        'accept-encoding': 'identity',
      },
      signal: AbortSignal.timeout(20_000),
    }, (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) {
        response.resume()
        fail(new Error(`El servidor respondió ${status}.`))
        return
      }
      const contentEncoding = response.headers['content-encoding']
      if (contentEncoding && contentEncoding !== 'identity') {
        response.destroy()
        fail(new Error('La fuente devolvió una compresión no compatible.'))
        return
      }
      const contentLength = Number(response.headers['content-length'] ?? 0)
      if (contentLength > maxBytes) {
        response.destroy()
        fail(new Error(`La fuente supera el tamaño máximo de ${Math.floor(maxBytes / (1024 * 1024))} MB.`))
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += bytes.byteLength
        if (total > maxBytes) {
          response.destroy()
          fail(new Error(`La fuente supera el tamaño máximo de ${Math.floor(maxBytes / (1024 * 1024))} MB.`))
          return
        }
        chunks.push(bytes)
      })
      response.on('end', () => {
        succeed(Buffer.concat(chunks))
      })
      response.on('error', fail)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    request.on('error', fail)
    request.end()
  })
}

export function fetchPinnedText(target: ResolvedFeedTarget, accept: string, maxBytes = 5 * 1024 * 1024, signal?: AbortSignal) {
  return fetchPinnedBytes(target, accept, maxBytes, signal).then((raw) => raw.toString('utf8'))
}
