import type { JsonSourceConfig, SourceKind } from './types'
import { ashbyArgentinaJsonConfig } from './ashby.ts'
import { greenhouseArgentinaJsonConfig, type GreenhouseCustomCareerUrlPattern } from './greenhouse.ts'
import {
  SMARTRECRUITERS_COFACE_COMPANY,
  SMARTRECRUITERS_COFACE_URL,
  SMARTRECRUITERS_CIELO_COMPANY,
  SMARTRECRUITERS_CIELO_URL,
  SMARTRECRUITERS_LDC_COMPANY,
  SMARTRECRUITERS_LDC_URL,
  SMARTRECRUITERS_MIRATECH_COMPANY,
  SMARTRECRUITERS_MIRATECH_URL,
  SMARTRECRUITERS_PSI_CRO_COMPANY,
  SMARTRECRUITERS_PSI_CRO_URL,
  smartRecruitersArgentinaJsonConfig,
  type SmartRecruitersCompany,
} from './smartrecruiters.ts'
import { workableArgentinaJsonConfig, WORKABLE_SUR_URL } from './workable.ts'

export type AutomaticSourceKind = Extract<SourceKind, 'rss' | 'json' | 'csv'>

export interface VerifiedSourcePolicy {
  id: string
  kind: AutomaticSourceKind
  url: string
  evidenceUrl: string
  reviewedOn: string
  title: string
  sourceName?: string
  connector?: 'lever-public-jobs' | 'smartrecruiters-posting-details' | 'greenhouse-public-jobs' | 'ashby-public-jobs' | 'workable-sur-public-jobs'
  greenhouseBoardToken?: string
  greenhouseCompanyName?: string
  greenhouseArgentinaRegionalLocationLabels?: readonly string[]
  greenhouseCustomCareerUrlPatterns?: readonly GreenhouseCustomCareerUrlPattern[]
  smartRecruitersCompany?: SmartRecruitersCompany
  leverArgentinaMaxPostings?: number
  leverArgentinaLocationLabels?: readonly string[]
  ashbyBoardToken?: string
  ashbyCompanyName?: string
  scope: string
  attribution: string
  requiredJsonConfig?: Partial<JsonSourceConfig>
}

const leverArgentinaJsonRequirements: Partial<JsonSourceConfig> = {
  itemsPath: '',
  filterPath: '/country',
  filterValue: 'AR',
}
const leverArgentinaLocationLabelsJsonRequirements: Partial<JsonSourceConfig> = {
  itemsPath: '',
  filterPath: '',
  filterValue: '',
}

const greenhouseArgentinaRequirements: Partial<JsonSourceConfig> = greenhouseArgentinaJsonConfig
const ashbyArgentinaRequirements: Partial<JsonSourceConfig> = ashbyArgentinaJsonConfig

type GreenhouseArgentinaBoard = {
  token: string
  company: string
  reviewedOn?: string
  evidenceUrl?: string
  argentinaRegionalLocationLabels?: readonly string[]
  customCareerUrlPatterns?: readonly GreenhouseCustomCareerUrlPattern[]
}

const greenhouseArgentinaBoards: readonly GreenhouseArgentinaBoard[] = [
  { token: 'invgate', company: 'InvGate' },
  { token: 'monsterenergylatam', company: 'Monster Energy LATAM' },
  { token: 'oliverargentina', company: 'OLIVER Agency Argentina' },
  { token: 'quintoandar', company: 'Grupo QuintoAndar' },
  { token: 'gympass', company: 'Wellhub' },
  { token: 'gofundme', company: 'GoFundMe' },
  { token: 'clara', company: 'Clara' },
  { token: 'sofitechsolutionslatam', company: 'SoFi Tech Solutions (LATAM)' },
  { token: 'webflow', company: 'Webflow' },
  { token: 'powerdigitalmarketing', company: 'Power Digital' },
  { token: 'brainlabs', company: 'Brainlabs' },
  { token: 'backblaze', company: 'Backblaze' },
  { token: 'sezzle', company: 'Sezzle' },
  { token: 'appdirect', company: 'AppDirect' },
  { token: 'able', company: 'Able', argentinaRegionalLocationLabels: ['LATAM', 'Latin America'] },
  { token: 'newsela', company: 'Newsela' },
  { token: 'precisionmedicinegroup', company: 'Precision Medicine Group' },
  { token: 'greenhouse', company: 'Greenhouse' },
  {
    token: 'coinbase',
    company: 'Coinbase',
    customCareerUrlPatterns: [{ hostname: 'www.coinbase.com', pathname: '/careers/positions/{jobId}', jobIdQueryParam: 'gh_jid' }],
  },
  { token: 'counterpart', company: 'Counterpart' },
  { token: 'interviewengineering', company: 'Karat (Interview Engineering)' },
  { token: 'nimblegravity', company: 'Nimble Gravity', argentinaRegionalLocationLabels: ['LATAM', 'Latin America'] },
  { token: 'jampp', company: 'Jampp', reviewedOn: '2026-10-09' },
  { token: 'fluxon', company: 'Fluxon', reviewedOn: '2026-10-09' },
  { token: 'arizeai', company: 'Arize AI', reviewedOn: '2026-10-09' },
  {
    token: 'cookunity',
    company: 'CookUnity',
    reviewedOn: '2026-10-09',
    customCareerUrlPatterns: [{ hostname: 'careers.cookunity.com', pathname: '/open-roles', jobIdQueryParam: 'gh_jid' }],
  },
  {
    token: 'dept',
    company: 'DEPT®',
    reviewedOn: '2026-10-09',
    evidenceUrl: 'https://www.dept.global/latam/trabajar-en-dept/empleos/',
  },
]

type AshbyArgentinaBoard = { token: string; company: string; reviewedOn?: string; evidenceUrl?: string }

const ashbyArgentinaBoards: readonly AshbyArgentinaBoard[] = [
  { token: 'rehire', company: 'Rehire' },
  { token: 'hirehangar', company: 'Hire Hangar' },
  { token: 'arq', company: 'ARQ' },
  { token: 'profound', company: 'Profound' },
  { token: 'silver', company: 'Silver.dev (avisos de clientes)' },
  { token: 'anyone-ai', company: 'Anyone AI (bolsa de empleo)' },
  { token: 'the-global-talent-co', company: 'The Global Talent Co. (empleador final por confirmar)' },
  { token: 'mural', company: 'Mural' },
  { token: 'omniscient', company: 'Omniscient Digital' },
  { token: 'optery', company: 'Optery' },
  { token: 'superhuman%20platform%20inc', company: 'Superhuman' },
  { token: 'go-nimbly', company: 'Go Nimbly' },
  { token: 'luxor', company: 'Luxor Technology' },
  { token: 'cas', company: 'Cloud Accountant Staffing', reviewedOn: '2026-10-09' },
  { token: 'bullpen-talent', company: 'Bullpen Talent (reclutador; empleador final por confirmar)', reviewedOn: '2026-10-09' },
  { token: 'latamcent', company: 'LatamCent (intermediario; empleador final por confirmar)', reviewedOn: '2026-10-09' },
  { token: 'Abode%20Money', company: 'Abode Money', reviewedOn: '2026-10-09' },
  { token: 'siena', company: 'Siena AI', reviewedOn: '2026-10-09', evidenceUrl: 'https://www.siena.cx/careers' },
] as const

/** Only entries researched against official documentation can run automatically. */
export const VERIFIED_SOURCE_POLICIES: readonly VerifiedSourcePolicy[] = [
  {
    id: 'workable-sur-argentina-json-2026-10-08',
    kind: 'json',
    url: WORKABLE_SUR_URL,
    evidenceUrl: 'https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page',
    reviewedOn: '2026-10-08',
    title: 'Avisos publicados de Sur con ubicación en Argentina',
    sourceName: 'Sur · oportunidades en Argentina (empleador final por confirmar)',
    connector: 'workable-sur-public-jobs',
    scope: 'Consulta el endpoint público de empleos publicados de Sur con detalles. Radar limita la respuesta a 250 registros, conserva solo país = Argentina, deduplica por código del puesto, valida los enlaces directos de apply.workable.com y falla si hay más de 100 avisos argentinos. El endpoint identifica a Sur como fuente, pero no confirma al empleador final. No envía postulaciones.',
    attribution: 'Los avisos se atribuyen a Sur; el empleador final debe confirmarse en la publicación original.',
    requiredJsonConfig: workableArgentinaJsonConfig,
  },
  {
    id: 'smartrecruiters-louis-dreyfus-argentina-json-2026-10-08',
    kind: 'json',
    url: SMARTRECRUITERS_LDC_URL,
    evidenceUrl: 'https://developers.smartrecruiters.com/docs/endpoints',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Louis Dreyfus Company en Argentina',
    sourceName: 'Louis Dreyfus Company · empleos en Argentina',
    connector: 'smartrecruiters-posting-details',
    smartRecruitersCompany: SMARTRECRUITERS_LDC_COMPANY,
    scope: 'Consulta el endpoint público de avisos publicados de Louis Dreyfus Company con country = ar y hasta 100 resultados. Radar recupera los detalles solo para obtener la publicación original, conserva avisos activos cuyo país sigue siendo ar y no envía postulaciones.',
    attribution: 'Los avisos se atribuyen a Louis Dreyfus Company y conservan el enlace público de cada publicación.',
    requiredJsonConfig: smartRecruitersArgentinaJsonConfig,
  },
  {
    id: 'smartrecruiters-coface-argentina-json-2026-10-09',
    kind: 'json',
    url: SMARTRECRUITERS_COFACE_URL,
    evidenceUrl: 'https://www.coface.com/career',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Coface en Argentina',
    sourceName: 'Coface · empleos en Argentina',
    connector: 'smartrecruiters-posting-details',
    smartRecruitersCompany: SMARTRECRUITERS_COFACE_COMPANY,
    scope: 'Consulta el endpoint público de avisos publicados de Coface con country = ar y hasta 100 resultados. Radar recupera los detalles solo para obtener la publicación original, conserva avisos activos cuyo país sigue siendo ar y no envía postulaciones.',
    attribution: 'Los avisos se atribuyen a Coface y conservan el enlace público de cada publicación.',
    requiredJsonConfig: smartRecruitersArgentinaJsonConfig,
  },
  {
    id: 'smartrecruiters-psi-cro-argentina-json-2026-10-09',
    kind: 'json',
    url: SMARTRECRUITERS_PSI_CRO_URL,
    evidenceUrl: 'https://psi-cro.com/careers/',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de PSI CRO en Argentina',
    sourceName: 'PSI CRO · empleos en Argentina',
    connector: 'smartrecruiters-posting-details',
    smartRecruitersCompany: SMARTRECRUITERS_PSI_CRO_COMPANY,
    scope: 'Consulta el endpoint público de avisos publicados de PSI CRO con country = ar y hasta 100 resultados. Radar recupera los detalles solo para obtener la publicación original, conserva avisos activos cuyo país sigue siendo ar y no envía postulaciones.',
    attribution: 'Los avisos se atribuyen a PSI CRO y conservan el enlace público de cada publicación.',
    requiredJsonConfig: smartRecruitersArgentinaJsonConfig,
  },
  {
    id: 'smartrecruiters-miratech-argentina-json-2026-10-09',
    kind: 'json',
    url: SMARTRECRUITERS_MIRATECH_URL,
    evidenceUrl: 'https://miratechgroup.com/career/',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Miratech en Argentina',
    sourceName: 'Miratech · empleos en Argentina',
    connector: 'smartrecruiters-posting-details',
    smartRecruitersCompany: SMARTRECRUITERS_MIRATECH_COMPANY,
    scope: 'Consulta el endpoint público de avisos publicados de Miratech con country = ar y hasta 100 resultados. Radar recupera los detalles solo para obtener la publicación original, conserva avisos activos cuyo país sigue siendo ar y no envía postulaciones.',
    attribution: 'Los avisos se atribuyen a Miratech y conservan el enlace público de cada publicación.',
    requiredJsonConfig: smartRecruitersArgentinaJsonConfig,
  },
  {
    id: 'smartrecruiters-cielo-argentina-json-2026-10-09',
    kind: 'json',
    url: SMARTRECRUITERS_CIELO_URL,
    evidenceUrl: 'https://careers.cielotalent.com/en/jobs',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Cielo en Argentina',
    sourceName: 'Cielo · empleos en Argentina',
    connector: 'smartrecruiters-posting-details',
    smartRecruitersCompany: SMARTRECRUITERS_CIELO_COMPANY,
    scope: 'Consulta el endpoint público de avisos publicados de Cielo con country = ar y hasta 100 resultados. Radar recupera los detalles para aplicar los filtros obligatorios, atribuye a Cielo y conserva el enlace público original; no envía postulaciones. El empleador y el servicio prestado a clientes deben confirmarse en cada aviso.',
    attribution: 'Los avisos se atribuyen a Cielo y conservan el enlace público de cada publicación.',
    requiredJsonConfig: smartRecruitersArgentinaJsonConfig,
  },
  {
    id: 'findjobit-argentina-rss-2026-10-08',
    kind: 'rss',
    url: 'https://findjobit.com/jobs/country/argentina/feed',
    evidenceUrl: 'https://findjobit.com/rss-feed',
    reviewedOn: '2026-10-08',
    title: 'Feed público de Findjobit para Argentina',
    scope: 'Lectura del feed público de empleos IT filtrado por país; no habilita consultas a otras páginas de Findjobit ni postulaciones automáticas.',
    attribution: 'Las ofertas deben atribuirse a Findjobit.',
  },
  {
    id: 'lever-despegar-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/despegar?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Despegar en Argentina',
    sourceName: 'Despegar · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Despegar y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-binance-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/binance?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Binance en Argentina',
    sourceName: 'Binance · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Binance y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-aleph-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/aleph?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Aleph en Argentina',
    sourceName: 'Aleph · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Aleph y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-redbee-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/redbee?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de redbee en Argentina',
    sourceName: 'redbee · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a redbee y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-bluelightconsulting-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/bluelightconsulting?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Bluelight Consulting en Argentina',
    sourceName: 'Bluelight Consulting · empleos en Argentina',
    connector: 'lever-public-jobs',
    leverArgentinaMaxPostings: 200,
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 200 resultados argentinos o falta de confirmación del final. Acepta hasta 200 para este tablero porque la lista completa incluyó 105 avisos únicos de Argentina el 8 de octubre de 2026. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Bluelight Consulting y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-handoff-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/handoff?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Handoff en Argentina',
    sourceName: 'Handoff · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Handoff y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-terrahq-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/terrahq?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Terra en Argentina',
    sourceName: 'Terra · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Terra y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-minders-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/minders?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Minders en Argentina',
    sourceName: 'Minders · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Minders y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-ryzlabs-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/RyzLabs?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de RYZ Labs en Argentina',
    sourceName: 'RYZ Labs · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a RYZ Labs y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-yuno-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/yuno?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Yuno en Argentina',
    sourceName: 'Yuno · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Yuno y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-listo-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/listo?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Listo en Argentina',
    sourceName: 'Listo · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el endpoint Lever exacto aprobado con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Listo y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-wing-assistant-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/getwingapp?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Wing Assistant en Argentina',
    sourceName: 'Wing Assistant · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el tablero público de Wing Assistant presentado en su página oficial de carreras, con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Wing Assistant y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-muttdata-argentina-json-2026-10-08',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/muttdata?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-08',
    title: 'Avisos públicos de Muttdata en Argentina',
    sourceName: 'Muttdata · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el tablero público de Muttdata enlazado desde su página oficial de carreras, con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Muttdata y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-trueml-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/trueml?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de TrueML en Argentina',
    sourceName: 'TrueML · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta el tablero público de TrueML enlazado desde su página oficial de carreras, con páginas de 100, hasta 2000 avisos y 25 MB acumulados; filtra localmente country = AR y falla ante páginas inválidas, avisos repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a TrueML y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  {
    id: 'lever-doola-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/doola?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de doola con ubicación en Argentina',
    sourceName: 'doola · empleos con ubicación en Argentina',
    connector: 'lever-public-jobs',
    leverArgentinaLocationLabels: ['Remote in Argentina'],
    scope: 'Consulta únicamente el tablero Lever de doola enlazado desde su página oficial de carreras. Como Lever informa Brasil o Chile en country aunque las ubicaciones secundarias incluyan Argentina, conserva solo avisos con country = AR o con la etiqueta exacta Remote in Argentina dentro de categories.allLocations. Coloca esa ubicación primero, pagina hasta 2000 avisos y 25 MB acumulados, limita a 100 elegibles y falla ante páginas inválidas, IDs repetidos, cambios en la primera página, exceso del límite o falta de confirmación del final. No habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a doola y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaLocationLabelsJsonRequirements,
  },
  {
    id: 'lever-sauce-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/Sauce?mode=json&limit=100',
    evidenceUrl: 'https://github.com/lever/postings-api',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Sauce con ubicación en Argentina',
    sourceName: 'Sauce · empleos con ubicación en Argentina',
    connector: 'lever-public-jobs',
    leverArgentinaLocationLabels: ['Argentina'],
    scope: 'Consulta únicamente el tablero Lever enlazado desde la página oficial de carreras de Sauce. La publicación remota People & Recruiting Specialist declara Brasil, Argentina, Colombia y México en allLocations, mientras country y la ubicación principal indican Brasil. Conserva avisos con country = AR o la etiqueta exacta Argentina en categories.allLocations, la prioriza en pantalla, pagina hasta 2000 avisos y 25 MB acumulados, limita a 100 elegibles y falla ante páginas inválidas, IDs repetidos, cambios en la primera página, exceso del límite o falta de confirmación del final. No habilita otros tableros ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Sauce y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaLocationLabelsJsonRequirements,
  },
  {
    id: 'lever-appen-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/appen-2?mode=json&limit=100',
    evidenceUrl: 'https://www.appen.com/careers?FullSite=1',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Appen con ubicación en Argentina',
    sourceName: 'Appen · empleos con ubicación en Argentina',
    connector: 'lever-public-jobs',
    leverArgentinaLocationLabels: ['Remote - Argentina'],
    scope: 'Consulta únicamente el tablero Lever público de Appen, identificado por sus avisos corporativos publicados. Conserva puestos con country = AR o con la etiqueta exacta Remote - Argentina dentro de categories.allLocations; no infiere elegibilidad por el título ni por menciones de Argentina. Prioriza esa etiqueta al mostrar el aviso, pagina hasta 2000 publicaciones y 25 MB acumulados, limita a 100 elegibles y falla ante páginas inválidas, IDs repetidos, cambios en la primera página, exceso del límite o falta de confirmación del final. No habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Appen y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaLocationLabelsJsonRequirements,
  },
  {
    id: 'lever-anchorage-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/anchorage?mode=json&limit=100',
    evidenceUrl: 'https://www.anchorage.com/careers',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Anchorage Digital con ubicación en Argentina',
    sourceName: 'Anchorage Digital · empleos con ubicación en Argentina',
    connector: 'lever-public-jobs',
    leverArgentinaLocationLabels: ['Argentina'],
    scope: 'Consulta únicamente el tablero Lever enlazado desde la página oficial de carreras de Anchorage Digital. Conserva avisos con country = AR o la etiqueta exacta Argentina dentro de categories.allLocations, la prioriza en pantalla y limita la consulta a 2000 publicaciones, 25 MB y 100 resultados argentinos. Los dos avisos elegibles revisados declaran modalidad remota y requieren una inducción presencial obligatoria; confirmar el viaje y las condiciones de contratación en la publicación antes de postularse. No habilita otros tableros ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Anchorage Digital y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaLocationLabelsJsonRequirements,
  },
  {
    id: 'lever-tryjeeves-argentina-json-2026-10-09',
    kind: 'json',
    url: 'https://api.lever.co/v0/postings/tryjeeves?mode=json&limit=100',
    evidenceUrl: 'https://www.tryjeeves.com/careers',
    reviewedOn: '2026-10-09',
    title: 'Avisos públicos de Jeeves en Argentina',
    sourceName: 'Jeeves · empleos en Argentina',
    connector: 'lever-public-jobs',
    scope: 'Consulta únicamente el tablero Lever enlazado desde la página oficial de carreras de Jeeves. En la revisión del 9 de octubre de 2026, el endpoint devolvió 77 avisos con IDs únicos; diez tenían country = AR y categories.allLocations = ["Argentina"]. Radar pagina las publicaciones, filtra localmente country = AR y falla ante páginas inválidas, IDs repetidos, cambios en la primera página, más de 100 resultados argentinos o falta de confirmación del final. Conserva el enlace original; no habilita otros tableros Lever ni postulaciones automáticas.',
    attribution: 'Los avisos se atribuyen a Jeeves y conservan el enlace a su publicación original.',
    requiredJsonConfig: leverArgentinaJsonRequirements,
  },
  ...greenhouseArgentinaBoards.map(({ token, company, reviewedOn = '2026-10-08', evidenceUrl = 'https://developers.greenhouse.io/job-board.html', argentinaRegionalLocationLabels, customCareerUrlPatterns }) => ({
    id: `greenhouse-${token}-argentina-json-${reviewedOn}`,
    kind: 'json' as const,
    url: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    evidenceUrl,
    reviewedOn,
    title: `Avisos públicos de ${company} en Argentina${argentinaRegionalLocationLabels ? ' y LATAM' : ''}`,
    sourceName: `${company} · empleos en Argentina${argentinaRegionalLocationLabels ? ' y LATAM' : ''}`,
    connector: 'greenhouse-public-jobs' as const,
    greenhouseBoardToken: token,
    greenhouseCompanyName: company,
    ...(argentinaRegionalLocationLabels ? { greenhouseArgentinaRegionalLocationLabels: argentinaRegionalLocationLabels } : {}),
    ...(customCareerUrlPatterns ? { greenhouseCustomCareerUrlPatterns: customCareerUrlPatterns } : {}),
    scope: `Consulta el endpoint público de empleos publicados del tablero ${company}, verifica el total de resultados, conserva ubicaciones argentinas${argentinaRegionalLocationLabels ? ` o etiquetas regionales revisadas (${argentinaRegionalLocationLabels.join(', ')})` : ''} y enlaces del tablero público o de las rutas y dominios de carreras revisados para esa fuente, con el ID del aviso validado. No calcula distancia para ubicaciones regionales ni envía postulaciones.`,
    attribution: `Los avisos se atribuyen a ${company} y conservan el enlace a su publicación original.`,
    requiredJsonConfig: greenhouseArgentinaRequirements,
  })),
  ...ashbyArgentinaBoards.map(({ token, company, reviewedOn = '2026-10-08', evidenceUrl = 'https://developers.ashbyhq.com/docs/public-job-posting-api' }) => ({
    id: `ashby-${token}-argentina-json-${reviewedOn}`,
    kind: 'json' as const,
    url: `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    evidenceUrl,
    reviewedOn,
    title: `Avisos públicos de ${company} con ubicaciones argentinas`,
    sourceName: `${company} · avisos para Argentina`,
    connector: 'ashby-public-jobs' as const,
    ashbyBoardToken: token,
    ashbyCompanyName: company,
    scope: `Consulta el endpoint público de avisos publicados de ${company}; solo conserva registros isListed = true cuya ubicación principal o secundaria habilita postulantes en Argentina. Muestra las ubicaciones declaradas con Argentina primero, limita cada respuesta a 250 avisos y falla si hay más de 100 resultados argentinos. No envía postulaciones.`,
    attribution: `Los avisos se atribuyen al tablero público de ${company} y conservan su enlace original.`,
    requiredJsonConfig: ashbyArgentinaRequirements,
  })),
]

export function verifiedSourcePolicyMatchesJsonConfig(policy: VerifiedSourcePolicy, config: JsonSourceConfig | null): boolean {
  const required = policy.requiredJsonConfig
  if (!required) return true
  return Boolean(config && Object.entries(required).every(([key, expected]) => config[key as keyof JsonSourceConfig] === expected))
}

export function findVerifiedSourcePolicy(kind: SourceKind, rawUrl: string): VerifiedSourcePolicy | null {
  if (kind === 'website') return null
  let candidate: URL
  try {
    candidate = new URL(rawUrl)
  } catch {
    return null
  }
  candidate.hash = ''
  return VERIFIED_SOURCE_POLICIES.find((policy) => policy.kind === kind && candidate.toString() === policy.url) ?? null
}

export function requireVerifiedSourcePolicy(kind: SourceKind, rawUrl: string): VerifiedSourcePolicy {
  const policy = findVerifiedSourcePolicy(kind, rawUrl)
  if (!policy) {
    throw new Error('Radar solo puede consultar automáticamente endpoints exactos con una política vigente investigada y registrada.')
  }
  return policy
}

export function findVerifiedSourcePolicyById(policyId: string | null | undefined): VerifiedSourcePolicy | null {
  return policyId ? VERIFIED_SOURCE_POLICIES.find((policy) => policy.id === policyId) ?? null : null
}
