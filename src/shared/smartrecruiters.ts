import type { JsonSourceConfig } from './types'

export const SMARTRECRUITERS_LDC_URL = 'https://api.smartrecruiters.com/v1/companies/LouisDreyfusCompany/postings?limit=100&offset=0&country=ar'
export const SMARTRECRUITERS_LDC_COMPANY = 'LouisDreyfusCompany'
export const SMARTRECRUITERS_COFACE_URL = 'https://api.smartrecruiters.com/v1/companies/Coface/postings?limit=100&offset=0&country=ar'
export const SMARTRECRUITERS_COFACE_COMPANY = 'Coface'
export const SMARTRECRUITERS_PSI_CRO_URL = 'https://api.smartrecruiters.com/v1/companies/PSICRO/postings?limit=100&offset=0&country=ar'
export const SMARTRECRUITERS_PSI_CRO_COMPANY = 'PSICRO'
export const SMARTRECRUITERS_MIRATECH_URL = 'https://api.smartrecruiters.com/v1/companies/Miratech1/postings?limit=100&offset=0&country=ar'
export const SMARTRECRUITERS_MIRATECH_COMPANY = 'Miratech1'
export const SMARTRECRUITERS_CIELO_URL = 'https://api.smartrecruiters.com/v1/companies/Cielo2/postings?limit=100&offset=0&country=ar'
export const SMARTRECRUITERS_CIELO_COMPANY = 'Cielo2'
export type SmartRecruitersCompany = typeof SMARTRECRUITERS_LDC_COMPANY | typeof SMARTRECRUITERS_COFACE_COMPANY | typeof SMARTRECRUITERS_PSI_CRO_COMPANY | typeof SMARTRECRUITERS_MIRATECH_COMPANY | typeof SMARTRECRUITERS_CIELO_COMPANY
export const SMARTRECRUITERS_URL_BY_COMPANY: Record<SmartRecruitersCompany, string> = {
  [SMARTRECRUITERS_LDC_COMPANY]: SMARTRECRUITERS_LDC_URL,
  [SMARTRECRUITERS_COFACE_COMPANY]: SMARTRECRUITERS_COFACE_URL,
  [SMARTRECRUITERS_PSI_CRO_COMPANY]: SMARTRECRUITERS_PSI_CRO_URL,
  [SMARTRECRUITERS_MIRATECH_COMPANY]: SMARTRECRUITERS_MIRATECH_URL,
  [SMARTRECRUITERS_CIELO_COMPANY]: SMARTRECRUITERS_CIELO_URL,
}
const smartRecruitersCompanyNames: Record<SmartRecruitersCompany, string> = {
  [SMARTRECRUITERS_LDC_COMPANY]: 'Louis Dreyfus Company',
  [SMARTRECRUITERS_COFACE_COMPANY]: 'Coface',
  [SMARTRECRUITERS_PSI_CRO_COMPANY]: 'PSI CRO',
  [SMARTRECRUITERS_MIRATECH_COMPANY]: 'Miratech',
  [SMARTRECRUITERS_CIELO_COMPANY]: 'Cielo',
}
export const SMARTRECRUITERS_MAX_POSTINGS = 100

export function smartRecruitersCompanyName(company: SmartRecruitersCompany) {
  return smartRecruitersCompanyNames[company]
}

export const smartRecruitersArgentinaJsonConfig: JsonSourceConfig = {
  itemsPath: '/content',
  titlePath: '/name',
  urlPath: '/postingUrl',
  descriptionPath: '/description',
  companyPath: '/companyName',
  locationPath: '/locationText',
  salaryPath: '',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/releasedDate',
  filterPath: '/country',
  filterValue: 'ar',
}

type SmartRecruitersPostingSummary = {
  id?: unknown
  company?: { identifier?: unknown }
  location?: { country?: unknown }
}

type SmartRecruitersList = {
  totalFound?: unknown
  content?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function smartRecruitersPostingIds(input: unknown, company: SmartRecruitersCompany = SMARTRECRUITERS_LDC_COMPANY): string[] {
  if (!isObject(input)) throw new Error('SmartRecruiters devolvió una lista con un formato no reconocido.')
  const result = input as SmartRecruitersList
  if (!Number.isSafeInteger(result.totalFound) || !Array.isArray(result.content)) {
    throw new Error('SmartRecruiters no devolvió el total y la lista de avisos esperados.')
  }
  const totalFound = result.totalFound as number
  if (totalFound > SMARTRECRUITERS_MAX_POSTINGS) {
    throw new Error(`SmartRecruiters informó ${totalFound} avisos; esta fuente admite hasta ${SMARTRECRUITERS_MAX_POSTINGS} por consulta.`)
  }
  if (result.content.length !== totalFound) {
    throw new Error('SmartRecruiters devolvió una lista parcial; no se importaron avisos para evitar una cobertura incompleta.')
  }

  return result.content.map((item, index) => {
    if (!isObject(item)) throw new Error(`El aviso ${index + 1} de SmartRecruiters no tiene un formato válido.`)
    const posting = item as SmartRecruitersPostingSummary
    if (posting.company?.identifier !== company) {
      throw new Error(`El aviso ${index + 1} no pertenece a ${smartRecruitersCompanyName(company)}.`)
    }
    if (posting.location?.country !== 'ar') {
      throw new Error(`El aviso ${index + 1} no cumple el filtro de país Argentina.`)
    }
    if (typeof posting.id !== 'string' || !/^\d{1,30}$/u.test(posting.id)) {
      throw new Error(`El aviso ${index + 1} no tiene un identificador público válido.`)
    }
    return posting.id
  })
}

export function smartRecruitersDetailsPayload(
  list: unknown,
  details: unknown[],
  company: SmartRecruitersCompany = SMARTRECRUITERS_LDC_COMPANY,
): { content: Array<Record<string, unknown>> } {
  const postingIds = smartRecruitersPostingIds(list, company)
  const companyName = smartRecruitersCompanyName(company)
  if (details.length !== postingIds.length) {
    throw new Error('SmartRecruiters no devolvió todos los detalles de la lista.')
  }
  const summaries = (list as { content: unknown[] }).content
  const content: Array<Record<string, unknown>> = []

  for (let index = 0; index < details.length; index += 1) {
    const summary = summaries[index] as SmartRecruitersPostingSummary
    const detail = details[index]
    if (!isObject(detail)) throw new Error(`SmartRecruiters devolvió un detalle inválido para el aviso ${postingIds[index]}.`)
    if (detail.id !== postingIds[index] || !isObject(detail.company) || detail.company.identifier !== company) {
      throw new Error(`El detalle ${postingIds[index]} no coincide con la empresa o el aviso solicitado.`)
    }
    if (!isObject(detail.location) || detail.location.country !== 'ar' || detail.active !== true) continue
    if (typeof detail.name !== 'string' || !detail.name.trim()) {
      throw new Error(`SmartRecruiters no devolvió el título del aviso ${postingIds[index]}.`)
    }
    if (typeof detail.postingUrl !== 'string') {
      throw new Error(`SmartRecruiters no devolvió el enlace público del aviso ${postingIds[index]}.`)
    }
    let postingUrl: URL
    try {
      postingUrl = new URL(detail.postingUrl)
    } catch {
      throw new Error(`SmartRecruiters devolvió un enlace inválido para el aviso ${postingIds[index]}.`)
    }
    if (postingUrl.protocol !== 'https:' || postingUrl.hostname !== 'jobs.smartrecruiters.com' || postingUrl.username || postingUrl.password || postingUrl.port || postingUrl.hash || [...postingUrl.searchParams.keys()].length > 0 || !postingUrl.pathname.startsWith(`/${company}/`) || !postingUrl.pathname.includes(String(postingIds[index]))) {
      throw new Error(`SmartRecruiters devolvió un enlace que no pertenece al tablero público de ${companyName}.`)
    }
    const location = detail.location
    const locationParts = [location.city, location.region]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim())
      .filter((value, index, parts) => parts.findIndex((part) => part.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
    const fullLocationParts = typeof location.fullLocation === 'string' && location.fullLocation.trim()
      ? location.fullLocation.split(',').map((value) => value.trim()).filter(Boolean)
      : locationParts
    const normalizedLocationParts = fullLocationParts
      .filter((value, index, parts) => value.toLocaleLowerCase() !== 'argentina' || parts.findIndex((part) => part.toLocaleLowerCase() === 'argentina') === index)
    if (!normalizedLocationParts.some((value) => value.toLocaleLowerCase() === 'argentina')) normalizedLocationParts.push('Argentina')
    const locationText = normalizedLocationParts.join(', ')
    const sections = isObject(detail.jobAd) && isObject(detail.jobAd.sections) ? detail.jobAd.sections : {}
    const description = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .flatMap((sectionName) => {
        const section = sections[sectionName]
        return isObject(section) && typeof section.text === 'string' && section.text.trim() ? [section.text.trim()] : []
      })
      .join('\n\n')
    const summaryCompany = isObject(detail.company) && typeof detail.company.name === 'string' ? detail.company.name : companyName
    content.push({
      country: 'ar',
      name: detail.name.trim(),
      postingUrl: postingUrl.toString(),
      description,
      companyName: summaryCompany,
      locationText,
      releasedDate: typeof detail.releasedDate === 'string' ? detail.releasedDate : '',
      sourceId: summary.id,
    })
  }
  return { content }
}
