import type { OpportunityTrackingInput } from './types'

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} debe ser una fecha válida.`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} debe ser una fecha válida.`)
  }
  return value
}

export function validateOpportunityTracking(input: unknown): OpportunityTrackingInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El seguimiento no tiene un formato válido.')
  }
  const value = input as Partial<OpportunityTrackingInput>
  if (typeof value.trackingNotes !== 'string' || value.trackingNotes.trim().length > 5000) {
    throw new Error('Las notas no pueden superar los 5000 caracteres.')
  }
  const appliedDate = optionalDate(value.appliedDate, 'La fecha de postulación')
  const followUpDate = optionalDate(value.followUpDate, 'La fecha de seguimiento')
  if (appliedDate && followUpDate && followUpDate < appliedDate) {
    throw new Error('La fecha de seguimiento no puede ser anterior a la fecha de postulación.')
  }
  return {
    appliedDate,
    followUpDate,
    trackingNotes: value.trackingNotes.trim(),
  }
}
