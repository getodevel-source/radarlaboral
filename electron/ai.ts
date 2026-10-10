import type { AppSettings } from '../src/shared/types'
import type { CandidateProfile, Opportunity } from '../src/shared/types'

const maxResponseBytes = 1024 * 1024

async function readLimitedText(response: Response) {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxResponseBytes) throw new Error('El proveedor devolvió una respuesta demasiado grande.')
  if (!response.body) throw new Error('El proveedor no devolvió contenido.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxResponseBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('El proveedor devolvió una respuesta demasiado grande.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function generateApplicationMessage(
  settings: AppSettings,
  apiKey: string | null,
  opportunity: Opportunity,
  resumeText: string,
  candidate: CandidateProfile,
) {
  if (!settings.aiEnabled) throw new Error('Activá la asistencia con IA en Preferencias antes de usarla.')
  if (!settings.aiBaseUrl || !settings.aiModel) throw new Error('Completá la dirección y el modelo del proveedor en Preferencias.')

  const endpoint = `${settings.aiBaseUrl.replace(/\/+$/, '')}/chat/completions`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.aiModel,
        temperature: 0.4,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'Redactás mensajes breves de postulación laboral en español rioplatense, claros y profesionales. Usá únicamente datos expresos en el CV, el aviso y los datos confirmados del perfil personal. No inventes experiencia, estudios, habilidades, disponibilidad, resultados ni datos personales. Si el CV no aporta un dato relevante, no lo supongas. Devolvé solo el mensaje, sin asunto, explicaciones ni comillas.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              puesto: opportunity.title,
              empresa: opportunity.company,
              localidad: opportunity.location,
              datosConfirmadosDeLaPersona: {
                nombre: candidate.fullName,
                localidad: candidate.location,
                disponibilidad: candidate.availability,
                movilidad: candidate.mobility,
                resumen: candidate.summary,
                otrosDatos: candidate.additionalFacts,
              },
              descripcionDelAviso: opportunity.description.slice(0, 12_000),
              textoDelCV: resumeText.slice(0, 24_000),
              instruccion: 'Prepará un mensaje de 80 a 130 palabras para que la persona lo revise antes de enviar. Si el CV no contiene información suficiente, redactá un texto neutral y breve.',
            }),
          },
        ],
      }),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : ''
    if (detail.includes('timed out')) throw new Error('El proveedor tardó demasiado. Probá otra vez.')
    throw new Error(`No se pudo conectar con el proveedor de IA: ${detail || 'revisá la dirección configurada.'}`)
  }

  const raw = await readLimitedText(response)
  if (!response.ok) {
    let detail = `respondió ${response.status}`
    try {
      const body = JSON.parse(raw) as { error?: { message?: unknown } }
      if (typeof body.error?.message === 'string') detail = body.error.message.slice(0, 300)
    } catch {
      // Keep the status if the provider did not return a JSON error.
    }
    throw new Error(`El proveedor de IA ${detail}.`)
  }

  let body: { choices?: Array<{ message?: { content?: unknown } }> }
  try {
    body = JSON.parse(raw) as typeof body
  } catch {
    throw new Error('El proveedor devolvió una respuesta que no se pudo leer.')
  }
  const message = body.choices?.[0]?.message?.content
  if (typeof message !== 'string' || !message.trim()) throw new Error('El proveedor no devolvió un mensaje de postulación.')
  return message.trim().slice(0, 4000)
}
