import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import brandIcon from '../resources/brand-icon.png'
import { SALARY_CURRENCIES } from './shared/types'
import { decodeCsvBytes, detectCsvDelimiter, parseCsvRows } from './shared/csv'
import { MANUAL_PORTALS } from './shared/manual-portals'
import { findVerifiedSourcePolicy, VERIFIED_SOURCE_POLICIES } from './shared/verified-source-policies'
import { ashbyArgentinaJsonConfig } from './shared/ashby'
import { greenhouseArgentinaJsonConfig } from './shared/greenhouse'
import { smartRecruitersArgentinaJsonConfig } from './shared/smartrecruiters'
import { workableArgentinaJsonConfig, WORKABLE_SUR_URL } from './shared/workable'
import { activateModalFocus } from './modal-focus'
import type {
  AppSettings,
  ApplicationDraft,
  CandidateProfile,
  CsvLocalImportInput,
  CsvLocalImportResult,
  CsvSourceConfig,
  DashboardSummary,
  FeedTestResult,
  GeorefLocalitySuggestion,
  JsonLocalImportInput,
  JsonLocalImportPreview,
  JsonLocalImportResult,
  JsonSourceConfig,
  Opportunity,
  OpportunityInput,
  OpportunityStatus,
  OpportunityTrackingInput,
  ResumeRecord,
  SearchProfile,
  SearchProfileInput,
  AppUpdateState,
  SourceKind,
  UserSource,
} from './shared/types'
import { copyPdfBytesForWorker } from './pdf-import'
import './App.css'

type PageKey = 'resumen' | 'busquedas' | 'vacantes' | 'cv' | 'fuentes' | 'ajustes'
type ModalKey = 'profile' | 'opportunity' | 'source' | 'draft' | 'tracking' | 'csv-import' | 'json-import' | null
type AppearanceTheme = 'light' | 'dark'

const savedAppearanceTheme = (): AppearanceTheme => {
  try {
    return window.localStorage.getItem('radar-laboral-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const salaryCurrencyLabels: Record<typeof SALARY_CURRENCIES[number], string> = {
  ARS: 'Pesos argentinos',
  USD: 'Dólares estadounidenses',
  EUR: 'Euros',
  GBP: 'Libras esterlinas',
  BRL: 'Reales brasileños',
  CLP: 'Pesos chilenos',
  UYU: 'Pesos uruguayos',
  PEN: 'Soles peruanos',
  COP: 'Pesos colombianos',
  MXN: 'Pesos mexicanos',
  CAD: 'Dólares canadienses',
  AUD: 'Dólares australianos',
  JPY: 'Yenes japoneses',
  CHF: 'Francos suizos',
  AWG: 'Florines arubeños',
  BOB: 'Bolivianos',
  CNH: 'Yuanes chinos offshore',
  CNY: 'Yuanes chinos',
  CZK: 'Coronas checas',
  DKK: 'Coronas danesas',
  HKD: 'Dólares de Hong Kong',
  ILS: 'Nuevos séqueles israelíes',
  INR: 'Rupias indias',
  NIO: 'Córdobas nicaragüenses',
  NOK: 'Coronas noruegas',
  NZD: 'Dólares neozelandeses',
  PYG: 'Guaraníes paraguayos',
  RSD: 'Dinares serbios',
  RUB: 'Rublos rusos',
  SEK: 'Coronas suecas',
  SGD: 'Dólares de Singapur',
  TRY: 'Liras turcas',
  VND: 'Dongs vietnamitas',
  ZAR: 'Rands sudafricanos',
}

interface ProfileForm {
  name: string
  searchDescription: string
  roles: string
  locations: string
  radiusKm: number
  includeKeywords: string
  excludeKeywords: string
  workMode: SearchProfileInput['workMode']
  schedule: string
  requireScheduleMatch: boolean
  workDaysPerWeek: string
  workHoursPerWeek: string
  minimumSalary: string
  minimumSalaryCurrency: SearchProfileInput['minimumSalaryCurrency']
  requireSalaryMatch: boolean
  convertSalaryCurrencies: boolean
  active: boolean
}

interface OpportunityForm {
  profileId: string
  title: string
  company: string
  location: string
  source: string
  url: string
  description: string
  salaryText: string
}

interface SourceForm {
  name: string
  url: string
  kind: SourceKind
  profileId: string
  customAutomationApproved: boolean
  automationEvidenceUrl: string
  jsonConfig: JsonSourceConfig
  csvConfig: CsvSourceConfig
}

const emptyProfileForm = (): ProfileForm => ({
  name: '',
  searchDescription: '',
  roles: '',
  locations: '',
  radiusKm: 25,
  includeKeywords: '',
  excludeKeywords: '',
  workMode: 'indistinto',
  schedule: '',
  requireScheduleMatch: false,
  workDaysPerWeek: '',
  workHoursPerWeek: '',
  minimumSalary: '',
  minimumSalaryCurrency: 'ARS',
  requireSalaryMatch: false,
  convertSalaryCurrencies: false,
  active: true,
})

const emptyOpportunityForm = (): OpportunityForm => ({
  profileId: '',
  title: '',
  company: '',
  location: '',
  source: '',
  url: '',
  description: '',
  salaryText: '',
})

const emptyJsonSourceConfig = (): JsonSourceConfig => ({
  itemsPath: '/jobs',
  titlePath: '/title',
  urlPath: '/url',
  descriptionPath: '/description',
  companyPath: '/company',
  locationPath: '/location',
  salaryPath: '/salary',
  salaryMinimumPath: '',
  salaryMaximumPath: '',
  salaryCurrencyPath: '',
  salaryPeriodPath: '',
  publishedAtPath: '/published_at',
  filterPath: '',
  filterValue: '',
})
const leverArgentinaJsonConfig = (): JsonSourceConfig => ({
  ...emptyJsonSourceConfig(),
  itemsPath: '',
  titlePath: '/text',
  urlPath: '/hostedUrl',
  descriptionPath: '/descriptionPlain',
  locationPath: '/categories/location',
  publishedAtPath: '/createdAt',
  filterPath: '/country',
  filterValue: 'AR',
})
const emptyCsvSourceConfig = (): CsvSourceConfig => ({
  delimiter: ',',
  titleColumn: 'title',
  urlColumn: 'url',
  descriptionColumn: 'description',
  companyColumn: 'company',
  locationColumn: 'location',
  salaryColumn: 'salary',
  salaryMinimumColumn: '',
  salaryMaximumColumn: '',
  salaryCurrencyColumn: '',
  salaryPeriodColumn: '',
  publishedAtColumn: 'published_at',
})
const csvImportColumns: Array<{ field: Exclude<keyof CsvSourceConfig, 'delimiter'>; label: string; required?: boolean; aliases: string[] }> = [
  { field: 'titleColumn', label: 'Puesto', required: true, aliases: ['title', 'puesto', 'título', 'cargo', 'job title', 'position', 'vacante'] },
  { field: 'urlColumn', label: 'Enlace del aviso', required: true, aliases: ['url', 'enlace', 'link', 'apply url', 'application url', 'postulación', 'inscripción'] },
  { field: 'companyColumn', label: 'Empresa', aliases: ['company', 'empresa', 'employer', 'empleador'] },
  { field: 'locationColumn', label: 'Localidad', aliases: ['location', 'localidad', 'ubicación', 'zona', 'city', 'ciudad', 'province', 'provincia'] },
  { field: 'descriptionColumn', label: 'Descripción', aliases: ['description', 'descripción', 'summary', 'resumen', 'detail', 'detalle'] },
  { field: 'salaryColumn', label: 'Sueldo en texto', aliases: ['salary', 'sueldo', 'salario', 'remuneración', 'compensation'] },
  { field: 'salaryMinimumColumn', label: 'Importe mínimo', aliases: ['salary min', 'salary minimum', 'sueldo mínimo', 'mínimo'] },
  { field: 'salaryMaximumColumn', label: 'Importe máximo', aliases: ['salary max', 'salary maximum', 'sueldo máximo', 'máximo'] },
  { field: 'salaryCurrencyColumn', label: 'Moneda', aliases: ['currency', 'moneda', 'salary currency'] },
  { field: 'salaryPeriodColumn', label: 'Período del sueldo', aliases: ['period', 'período', 'salary period', 'frecuencia'] },
  { field: 'publishedAtColumn', label: 'Fecha de publicación', aliases: ['published at', 'published', 'fecha', 'fecha publicación', 'fecha de publicación'] },
]
const normalizeCsvHeader = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-AR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const csvImportConfigFor = (headers: string[], delimiter: CsvSourceConfig['delimiter']): CsvSourceConfig => {
  const config: CsvSourceConfig = { ...emptyCsvSourceConfig(), delimiter }
  for (const { field, aliases } of csvImportColumns) {
    const normalizedAliases = aliases.map(normalizeCsvHeader)
    config[field] = headers.find((header) => normalizedAliases.includes(normalizeCsvHeader(header))) ?? ''
  }
  return config
}
const emptySourceForm = (): SourceForm => ({ name: '', url: '', kind: 'rss', profileId: '', customAutomationApproved: false, automationEvidenceUrl: '', jsonConfig: emptyJsonSourceConfig(), csvConfig: emptyCsvSourceConfig() })
const findjobitArgentinaFeedUrl = 'https://findjobit.com/jobs/country/argentina/feed'
const despegarArgentinaJobsUrl = 'https://api.lever.co/v0/postings/despegar?mode=json&limit=100'
const workableSurArgentinaJobsUrl = WORKABLE_SUR_URL
const additionalLeverArgentinaPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.kind === 'json' && policy.id.startsWith('lever-') && policy.id !== 'lever-despegar-argentina-json-2026-10-08')
const smartRecruitersArgentinaPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'smartrecruiters-posting-details')
const greenhouseArgentinaPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'greenhouse-public-jobs')
const ashbyArgentinaPolicies = VERIFIED_SOURCE_POLICIES.filter((policy) => policy.connector === 'ashby-public-jobs')
const isAutomaticSourceKind = (kind: SourceKind) => kind === 'rss' || kind === 'json' || kind === 'csv'
const sourceTestKey = (form: SourceForm) => JSON.stringify({
  kind: form.kind,
  url: form.url,
  config: form.kind === 'json' ? form.jsonConfig : form.kind === 'csv' ? form.csvConfig : null,
})

const splitTerms = (value: string) => value.split(/[\n,;]+/).map((term) => term.trim()).filter(Boolean)
const splitLocations = (value: string) => value.split(/[\n;]+/).map((term) => term.trim()).filter(Boolean)
const displayProfileLocation = (value: string) => value.replace(/\s+\[Georef:[A-Za-z0-9_-]{1,80}\]\s*$/iu, '').trim()

const profileToForm = (profile: SearchProfile): ProfileForm => ({
  name: profile.name,
  searchDescription: profile.searchDescription,
  roles: profile.roles.join(', '),
  locations: profile.locations.join('; '),
  radiusKm: profile.radiusKm,
  includeKeywords: profile.includeKeywords.join(', '),
  excludeKeywords: profile.excludeKeywords.join(', '),
  workMode: profile.workMode,
  schedule: profile.schedule,
  requireScheduleMatch: profile.requireScheduleMatch,
  workDaysPerWeek: profile.workDaysPerWeek === null ? '' : String(profile.workDaysPerWeek),
  workHoursPerWeek: profile.workHoursPerWeek === null ? '' : String(profile.workHoursPerWeek),
  minimumSalary: profile.minimumSalary === null ? '' : String(profile.minimumSalary),
  minimumSalaryCurrency: profile.minimumSalaryCurrency,
  requireSalaryMatch: profile.requireSalaryMatch,
  convertSalaryCurrencies: profile.convertSalaryCurrencies,
  active: profile.active,
})

const toProfileInput = (form: ProfileForm): SearchProfileInput => ({
  name: form.name.trim(),
  searchDescription: form.searchDescription.trim(),
  roles: splitTerms(form.roles),
  locations: splitLocations(form.locations),
  radiusKm: Number(form.radiusKm),
  includeKeywords: splitTerms(form.includeKeywords),
  excludeKeywords: splitTerms(form.excludeKeywords),
  workMode: form.workMode,
  schedule: form.schedule.trim(),
  requireScheduleMatch: form.requireScheduleMatch,
  workDaysPerWeek: form.workDaysPerWeek ? Number(form.workDaysPerWeek) : null,
  workHoursPerWeek: form.workHoursPerWeek ? Number(form.workHoursPerWeek) : null,
  minimumSalary: form.minimumSalary ? Number(form.minimumSalary) : null,
  minimumSalaryCurrency: form.minimumSalaryCurrency,
  requireSalaryMatch: form.requireSalaryMatch,
  convertSalaryCurrencies: form.convertSalaryCurrencies,
  active: form.active,
})

const statusLabels: Record<OpportunityStatus, string> = {
  nueva: 'Nueva',
  revisada: 'Revisada',
  guardada: 'Guardada',
  postulada: 'Postulada',
  descartada: 'Descartada',
}

const formatDate = (value: string | null) => {
  if (!value) return 'Sin fecha'
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return formatDateOnly(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(date)
}

const normalizeSearchText = (value: string) => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLocaleLowerCase('es-AR')

const formatLocalImportResult = (result: CsvLocalImportResult | JsonLocalImportResult) => {
  const parts = [`${result.added} ${result.added === 1 ? 'vacante agregada' : 'vacantes agregadas'}`]
  if (result.duplicates) parts.push(`${result.duplicates} repetida${result.duplicates === 1 ? '' : 's'}`)
  if (result.filtered) parts.push(`${result.filtered} fuera de los filtros del perfil`)
  if (result.skipped) parts.push(`${result.skipped} incompleta${result.skipped === 1 ? '' : 's'} u omitida${result.skipped === 1 ? '' : 's'}`)
  return `Importación terminada: ${parts.join(' · ')}.`
}

const formatDateOnly = (value: string | null) => {
  if (!value) return 'Sin fecha'
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

const blankSummary: DashboardSummary = {
  activeProfiles: 0,
  activeSources: 0,
  newOpportunities: 0,
  applicationsSent: 0,
  resumes: 0,
}

const blankSettings: AppSettings = {
  searchIntervalHours: 4,
  backgroundSearchEnabled: false,
  aiEnabled: false,
  aiBaseUrl: '',
  aiModel: '',
  aiApiKeyConfigured: false,
  salaryExchangeRates: null,
}

const blankCandidate: CandidateProfile = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  availability: '',
  mobility: '',
  summary: '',
  additionalFacts: '',
  updatedAt: null,
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4" rx="1.5" /><rect x="13.5" y="9.5" width="7" height="11" rx="1.5" /><rect x="3.5" y="12.5" width="7" height="8" rx="1.5" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4.3 4.3" /><path d="M10.8 7.8v6M7.8 10.8h6" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
    file: <><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h7" /></>,
    link: <><path d="M10 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" /><path d="M14 10.2a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.9l1.7-1.7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    spark: <><path d="m12 3 1.6 6.1L20 11l-6.4 1.7L12 19l-1.6-6.3L4 11l6.4-1.9L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
    sun: <><circle cx="12" cy="12" r="3.4" /><path d="M12 2.5v2M12 19.5v2M4.4 4.4l1.4 1.4m12.4 12.4 1.4 1.4M2.5 12h2m15 0h2M4.4 19.6l1.4-1.4M18.2 5.8l1.4-1.4" /></>,
    moon: <path d="M20.2 15.3A8.8 8.8 0 0 1 8.7 3.8 8.8 8.8 0 1 0 20.2 15.3Z" />,
  }
  if (import.meta.env.DEV && !Object.hasOwn(paths, name)) console.warn(`Icono desconocido: ${name}`)
  return <svg {...common}>{paths[name] ?? paths.overview}</svg>
}

function App() {
  const [theme, setTheme] = useState<AppearanceTheme>(savedAppearanceTheme)
  const [page, setPage] = useState<PageKey>('resumen')
  const [profiles, setProfiles] = useState<SearchProfile[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [resumes, setResumes] = useState<ResumeRecord[]>([])
  const [sources, setSources] = useState<UserSource[]>([])
  const [drafts, setDrafts] = useState<ApplicationDraft[]>([])
  const [summary, setSummary] = useState(blankSummary)
  const [settings, setSettings] = useState(blankSettings)
  const [candidateProfile, setCandidateProfile] = useState(blankCandidate)
  const [modal, setModal] = useState<ModalKey>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm)
  const [localityQuery, setLocalityQuery] = useState('')
  const [localitySuggestions, setLocalitySuggestions] = useState<GeorefLocalitySuggestion[]>([])
  const [localityActiveIndex, setLocalityActiveIndex] = useState(-1)
  const [opportunityForm, setOpportunityForm] = useState<OpportunityForm>(emptyOpportunityForm)
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm)
  const [csvImportContents, setCsvImportContents] = useState('')
  const [csvImportFileName, setCsvImportFileName] = useState('')
  const [csvImportEncoding, setCsvImportEncoding] = useState('')
  const [csvImportSourceName, setCsvImportSourceName] = useState('')
  const [csvImportFileError, setCsvImportFileError] = useState('')
  const [csvImportProfileId, setCsvImportProfileId] = useState('')
  const [csvImportConfig, setCsvImportConfig] = useState<CsvSourceConfig>(() => csvImportConfigFor([], ','))
  const [jsonImportContents, setJsonImportContents] = useState('')
  const [jsonImportFileName, setJsonImportFileName] = useState('')
  const [jsonImportFileError, setJsonImportFileError] = useState('')
  const [jsonImportSourceId, setJsonImportSourceId] = useState('')
  const [jsonImportProfileId, setJsonImportProfileId] = useState('')
  const [jsonImportPreview, setJsonImportPreview] = useState<{ result?: JsonLocalImportPreview; error?: string } | null>(null)
  const [previewingJsonImport, setPreviewingJsonImport] = useState(false)
  const [sourceTest, setSourceTest] = useState<{ result?: FeedTestResult; error?: string; key: string } | null>(null)
  const [draftMessage, setDraftMessage] = useState('')
  const [draftResumeContent, setDraftResumeContent] = useState('')
  const [draftResumeId, setDraftResumeId] = useState('')
  const [draftId, setDraftId] = useState<string | undefined>()
  const [trackingForm, setTrackingForm] = useState({ appliedDate: '', followUpDate: '', trackingNotes: '' })
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todas' | OpportunityStatus>('todas')
  const [profileFilter, setProfileFilter] = useState('todas')
  const [query, setQuery] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [toast, setToast] = useState({ id: 0, text: '' })

  const toastSeq = useRef(0)
  const updateStateEventSequence = useRef(0)
  const csvImportFileReadSequence = useRef(0)
  const jsonImportPreviewSequence = useRef(0)
  const jsonImportFileReadSequence = useRef(0)
  const [followUpReminderQueue, setFollowUpReminderQueue] = useState<Array<{ deliveryId: string; text: string }>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testingSource, setTestingSource] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17201b' : '#f4f3ef')
    try {
      window.localStorage.setItem('radar-laboral-theme', theme)
    } catch {
      showToast('No se pudo guardar el tema en este perfil de Windows.')
    }
  }, [theme])

  function invalidateJsonImportPreview() {
    jsonImportPreviewSequence.current += 1
    setJsonImportPreview(null)
    setPreviewingJsonImport(false)
  }

  const refresh = useCallback(async () => {
    const [nextProfiles, nextOpportunities, nextResumes, nextSources, nextDrafts, nextSummary, nextVersion] = await Promise.all([
      window.radar.profiles.list(),
      window.radar.opportunities.list(),
      window.radar.resumes.list(),
      window.radar.sources.list(),
      window.radar.drafts.list(),
      window.radar.app.summary(),
      window.radar.app.version().catch(() => ''),
    ])
    setProfiles(nextProfiles)
    setOpportunities(nextOpportunities)
    setResumes(nextResumes)
    setSources(nextSources)
    setDrafts(nextDrafts)
    setSummary(nextSummary)
    setAppVersion(nextVersion)
  }, [])

  const loadPreferences = useCallback(async () => {
    const [nextSettings, nextCandidate] = await Promise.all([
      window.radar.app.settings(),
      window.radar.candidate.get(),
    ])
    setSettings(nextSettings)
    setCandidateProfile(nextCandidate)
  }, [])

  useEffect(() => {
    void Promise.all([refresh(), loadPreferences()]).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'No se pudieron cargar tus datos.'))
      .finally(() => setLoading(false))
  }, [refresh, loadPreferences])

  useEffect(() => {
    const query = localityQuery.trim()
    if (modal !== 'profile' || query.length < 2) {
      setLocalitySuggestions([])
      setLocalityActiveIndex(-1)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void window.radar.geography.searchLocalities(query)
        .then((suggestions) => { if (active) { setLocalitySuggestions(suggestions); setLocalityActiveIndex(-1) } })
        .catch(() => { if (active) { setLocalitySuggestions([]); setLocalityActiveIndex(-1) } })
    }, 160)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [localityQuery, modal])

  useEffect(() => {
    const off = window.radar.app.onSearchCompleted(() => {
      void refresh().catch((error: unknown) => showToast(error instanceof Error ? error.message : 'No se pudieron actualizar las fuentes.'))
    })
    return off
  }, [refresh])

  useEffect(() => {
    let active = true
    const off = window.radar.app.onUpdateState((next) => {
      updateStateEventSequence.current += 1
      setUpdateState(next)
      if (next.status === 'downloaded') {
        showToast(next.message)
      }
    })
    const requestedAtSequence = updateStateEventSequence.current
    void window.radar.app.updateStatus()
      .then((next) => {
        if (active && updateStateEventSequence.current === requestedAtSequence) setUpdateState(next)
      })
      .catch(() => {})
    return () => {
      active = false
      off()
    }
  }, [])

  useEffect(() => {
    const off = window.radar.app.onSearchCompletionNotice(({ added, errors, truncated }) => {
      const messages: string[] = []
      if (added > 0) messages.push(added === 1 ? 'Se agregó 1 aviso nuevo.' : `Se agregaron ${added} avisos nuevos.`)
      if (errors > 0) messages.push(errors === 1 ? 'Falló la consulta de 1 fuente. Revisá Fuentes.' : `Falló la consulta de ${errors} fuentes. Revisá Fuentes.`)
      const truncatedCount = truncated ?? 0
      if (truncatedCount > 0) messages.push(truncatedCount === 1 ? '1 fuente devolvió más avisos de los revisados por consulta.' : `${truncatedCount} fuentes devolvieron más avisos de los revisados por consulta.`)
      showToast(messages.join(' '))
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.radar.app.onSearchFailed((count) => {
      showToast(count === 1
        ? 'Una búsqueda automática no pudo completarse. Revisá Fuentes o intentá de nuevo.'
        : `${count} búsquedas automáticas no pudieron completarse. Revisá Fuentes o intentá de nuevo.`)
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.radar.app.onFollowUpReminder((count, deliveryId) => {
      setPage('vacantes')
      setStatusFilter('postulada')
      setProfileFilter('todas')
      setQuery('')
      const text = count === 1
        ? 'Llegó la fecha para retomar una postulación. Revisá Vacantes en estado Postulada.'
        : `Llegó la fecha para retomar ${count} postulaciones. Revisá Vacantes en estado Postulada.`
      toastSeq.current += 1
      setToast({ id: toastSeq.current, text })
      setFollowUpReminderQueue((current) => [...current, { deliveryId, text }])
    })
    return off
  }, [])

  useLayoutEffect(() => {
    const [current] = followUpReminderQueue
    if (!current || !toast.text || toast.text !== current.text) return
    try {
      window.radar.app.acknowledgeFollowUpReminder(current.deliveryId)
    } catch {
      // The main process already dropped the pending delivery; nothing to retry.
    }
    setFollowUpReminderQueue((pending) => pending.slice(1))
  }, [followUpReminderQueue, toast])

  useEffect(() => {
    if (!toast.text) return
    const timer = window.setTimeout(() => setToast((current) => current.id === toast.id ? { id: 0, text: '' } : current), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const jsonImportSources = useMemo(
    () => sources.filter((source) => source.kind === 'json' && source.jsonConfig),
    [sources],
  )

  const filteredOpportunities = useMemo(() => opportunities.filter((opportunity) => {
    const matchesStatus = statusFilter === 'todas' || opportunity.status === statusFilter
    const matchesProfile = profileFilter === 'todas'
      || (profileFilter === 'sin-perfil' ? !opportunity.profileId : opportunity.profileId === profileFilter)
    const profileName = profiles.find((profile) => profile.id === opportunity.profileId)?.name ?? ''
    const text = normalizeSearchText(`${opportunity.title} ${opportunity.company} ${opportunity.location} ${opportunity.source} ${opportunity.description} ${profileName}`)
    return matchesStatus && matchesProfile && text.includes(normalizeSearchText(query.trim()))
  }), [opportunities, profiles, profileFilter, query, statusFilter])

  const csvImportPreview = useMemo(() => {
    if (!csvImportContents) return { headers: [] as string[], rowCount: 0, samples: [] as Array<{ title: string; company: string; url: string }>, error: '' }
    try {
      const rows = parseCsvRows(csvImportContents, csvImportConfig.delimiter)
      if (!rows.length) throw new Error('El CSV está vacío y no contiene encabezados.')
      const headers = rows[0].map((header) => header.trim())
      if (headers.some((header) => !header)) throw new Error('Todos los encabezados de la primera fila deben tener un nombre.')
      if (headers.length > 100) throw new Error('El CSV supera el límite de 100 columnas.')
      if (new Set(headers).size !== headers.length) throw new Error('El CSV repite un encabezado; corregilo antes de importar.')
      const positions = new Map(headers.map((header, index) => [header, index]))
      const readCell = (row: string[], field: Exclude<keyof CsvSourceConfig, 'delimiter'>) => {
        const column = csvImportConfig[field]
        const position = column ? positions.get(column) : undefined
        return position === undefined ? '' : (row[position] ?? '').trim()
      }
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0))
      const samples = dataRows.flatMap((row) => {
        const title = readCell(row, 'titleColumn')
        const url = readCell(row, 'urlColumn')
        if (!title || !url) return []
        return [{ title, company: readCell(row, 'companyColumn') || 'Empresa no informada', url }]
      }).slice(0, 3)
      return { headers, rowCount: dataRows.length, samples, error: '' }
    } catch (error) {
      return { headers: [] as string[], rowCount: 0, samples: [] as Array<{ title: string; company: string; url: string }>, error: error instanceof Error ? error.message : 'No se pudo leer el CSV.' }
    }
  }, [csvImportConfig, csvImportContents])

  function showToast(message: string) {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, text: message })
  }

  function openProfile(profile?: SearchProfile) {
    setEditingProfileId(profile?.id ?? null)
    setProfileForm(profile ? profileToForm(profile) : emptyProfileForm())
    setLocalityQuery('')
    setLocalitySuggestions([])
    setLocalityActiveIndex(-1)
    setModal('profile')
  }

  function addGeorefLocality(locality: GeorefLocalitySuggestion) {
    const selection = `${locality.label} [Georef:${locality.id}]`
    const locations = splitLocations(profileForm.locations)
    if (!locations.includes(selection)) {
      setProfileForm((current) => ({
        ...current,
        locations: [...splitLocations(current.locations), selection].join('; '),
      }))
    }
    setLocalityQuery('')
    setLocalitySuggestions([])
    setLocalityActiveIndex(-1)
  }

  function openOpportunity() {
    setOpportunityForm({ ...emptyOpportunityForm(), profileId: profiles[0]?.id ?? '' })
    setModal('opportunity')
  }

  function openSource() {
    setSourceForm({ ...emptySourceForm(), profileId: profiles[0]?.id ?? '' })
    setSourceTest(null)
    setModal('source')
  }

  function openCsvImport() {
    csvImportFileReadSequence.current += 1
    setCsvImportContents('')
    setCsvImportFileName('')
    setCsvImportEncoding('')
    setCsvImportSourceName('')
    setCsvImportFileError('')
    setCsvImportProfileId(profiles[0]?.id ?? '')
    setCsvImportConfig(csvImportConfigFor([], ','))
    setModal('csv-import')
  }

  function openJsonImport() {
    invalidateJsonImportPreview()
    jsonImportFileReadSequence.current += 1
    const firstSource = jsonImportSources[0]
    setJsonImportContents('')
    setJsonImportFileName('')
    setJsonImportFileError('')
    setJsonImportSourceId(firstSource?.id ?? '')
    setJsonImportProfileId(firstSource?.profileId ?? profiles[0]?.id ?? '')
    setJsonImportPreview(null)
    setModal('json-import')
  }

  function closeActiveModal() {
    if (modal === 'csv-import') {
      csvImportFileReadSequence.current += 1
      setCsvImportContents('')
      setCsvImportFileName('')
      setCsvImportEncoding('')
      setCsvImportSourceName('')
      setCsvImportFileError('')
    }
    if (modal === 'json-import') {
      invalidateJsonImportPreview()
      jsonImportFileReadSequence.current += 1
      setJsonImportContents('')
      setJsonImportFileName('')
      setJsonImportFileError('')
      setJsonImportPreview(null)
    }
    setModal(null)
  }

  async function selectCsvImportFile(file: File | undefined) {
    if (!file) return
    const requestSequence = ++csvImportFileReadSequence.current
    setCsvImportContents('')
    setCsvImportFileName(file.name)
    setCsvImportEncoding('')
    setCsvImportSourceName('')
    setCsvImportFileError('')
    if (file.size > 5 * 1024 * 1024) {
      setCsvImportFileError('El archivo supera el límite local de 5 MB.')
      return
    }
    try {
      const decoded = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
      if (requestSequence !== csvImportFileReadSequence.current) return
      const contents = decoded.contents
      const delimiter = detectCsvDelimiter(contents)
      const rows = parseCsvRows(contents, delimiter)
      const headers = rows[0]?.map((header) => header.trim()) ?? []
      setCsvImportContents(contents)
      setCsvImportFileName(file.name)
      setCsvImportEncoding(decoded.encoding)
      setCsvImportSourceName(file.name.replace(/\.(?:csv|tsv)$/iu, '').slice(0, 120))
      setCsvImportFileError('')
      setCsvImportConfig(csvImportConfigFor(headers, delimiter))
    } catch (error) {
      if (requestSequence === csvImportFileReadSequence.current) {
        setCsvImportFileError(error instanceof Error ? error.message : 'No se pudo leer el CSV.')
      }
    }
  }

  async function selectJsonImportFile(file: File | undefined) {
    if (!file) return
    invalidateJsonImportPreview()
    const requestSequence = ++jsonImportFileReadSequence.current
    setJsonImportContents('')
    setJsonImportFileName(file.name)
    setJsonImportFileError('')
    if (file.size > 5 * 1024 * 1024) {
      setJsonImportFileError('El archivo JSON supera el límite local de 5 MB.')
      return
    }
    try {
      const contents = decodeCsvBytes(new Uint8Array(await file.arrayBuffer())).contents
      if (requestSequence !== jsonImportFileReadSequence.current) return
      setJsonImportContents(contents)
    } catch (error) {
      if (requestSequence === jsonImportFileReadSequence.current) {
        setJsonImportFileError(error instanceof Error ? error.message : 'No se pudo leer el archivo JSON.')
      }
    }
  }

  async function previewJsonOpportunities() {
    if (!jsonImportContents || !jsonImportSourceId) return
    const requestSequence = ++jsonImportPreviewSequence.current
    setPreviewingJsonImport(true)
    setJsonImportPreview(null)
    try {
      const input: JsonLocalImportInput = {
        contents: jsonImportContents,
        sourceId: jsonImportSourceId,
        profileId: jsonImportProfileId || null,
      }
      const result = await window.radar.opportunities.previewJsonImport(input)
      if (requestSequence === jsonImportPreviewSequence.current) setJsonImportPreview({ result })
    } catch (error) {
      if (requestSequence === jsonImportPreviewSequence.current) {
        setJsonImportPreview({ error: error instanceof Error ? error.message : 'No se pudo revisar el JSON local.' })
      }
    } finally {
      if (requestSequence === jsonImportPreviewSequence.current) setPreviewingJsonImport(false)
    }
  }

  async function testSource() {
    const key = sourceTestKey(sourceForm)
    setSourceTest(null)
    setTestingSource(true)
    try {
      const result = sourceForm.kind === 'json'
        ? await window.radar.sources.testJson(sourceForm.url, sourceForm.jsonConfig)
        : sourceForm.kind === 'csv'
          ? await window.radar.sources.testCsv(sourceForm.url, sourceForm.csvConfig)
          : await window.radar.sources.testRss(sourceForm.url)
      setSourceTest({ result, key })
    } catch (error) {
      setSourceTest({ error: error instanceof Error ? error.message : 'No se pudo leer la fuente.', key })
    } finally {
      setTestingSource(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = toProfileInput(profileForm)
    if (!input.roles.length && !input.searchDescription) return showToast('Escribí qué tipo de trabajo buscás, en los filtros o en tu descripción.')
    if (!input.locations.length) return showToast('Agregá una ubicación o escribí “Argentina”.')
    setBusy(true)
    try {
      await window.radar.profiles.save({ ...input, ...(editingProfileId ? { id: editingProfileId } : {}) })
      await refresh()
      setModal(null)
      showToast(editingProfileId ? 'Búsqueda actualizada.' : 'Búsqueda creada.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar la búsqueda.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteProfile(id: string) {
    if (busy) return
    if (!window.confirm('¿Eliminar esta búsqueda? Las vacantes guardadas se mantienen en el seguimiento.')) return
    setBusy(true)
    try {
      await window.radar.profiles.remove(id)
      await refresh()
      showToast('Búsqueda eliminada.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo eliminar la búsqueda.')
    } finally {
      setBusy(false)
    }
  }

  async function saveOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input: OpportunityInput = {
      ...opportunityForm,
      profileId: opportunityForm.profileId || null,
    }
    setBusy(true)
    try {
      await window.radar.opportunities.add(input)
      await refresh()
      setModal(null)
      showToast('Vacante agregada a tu seguimiento.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar la vacante.')
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(opportunity: Opportunity, status: OpportunityStatus) {
    if (busy) return
    setBusy(true)
    try {
      await window.radar.opportunities.updateStatus(opportunity.id, status)
      await refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.')
    } finally {
      setBusy(false)
    }
  }

  function openTracking(opportunity: Opportunity) {
    setSelectedOpportunity(opportunity)
    setTrackingForm({
      appliedDate: opportunity.appliedDate ?? '',
      followUpDate: opportunity.followUpDate ?? '',
      trackingNotes: opportunity.trackingNotes,
    })
    setModal('tracking')
  }

  async function saveTracking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOpportunity) return
    const tracking: OpportunityTrackingInput = {
      appliedDate: trackingForm.appliedDate || null,
      followUpDate: trackingForm.followUpDate || null,
      trackingNotes: trackingForm.trackingNotes,
    }
    setBusy(true)
    try {
      await window.radar.opportunities.updateTracking(selectedOpportunity.id, tracking)
      await refresh()
      setModal(null)
      showToast('Seguimiento actualizado en esta computadora.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar el seguimiento.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      await window.radar.sources.add({
        name: sourceForm.name,
        url: sourceForm.url,
        kind: sourceForm.kind,
        profileId: sourceForm.profileId || null,
        enabled: true,
        customAutomationApproved: !findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url) && sourceForm.customAutomationApproved,
        automationEvidenceUrl: sourceForm.automationEvidenceUrl,
        jsonConfig: sourceForm.kind === 'json' ? sourceForm.jsonConfig : null,
        csvConfig: sourceForm.kind === 'csv' ? sourceForm.csvConfig : null,
      })
      await refresh()
      setModal(null)
      showToast(sourceForm.kind === 'website'
        ? 'Enlace agregado para revisión manual.'
        : findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url)
          ? 'Fuente automática verificada agregada.'
          : sourceForm.customAutomationApproved
            ? 'Fuente agregada y autorizada para consultas automáticas.'
            : 'Fuente guardada en modo asistido. Radar no consultará su enlace automáticamente.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar la fuente.')
    } finally {
      setBusy(false)
    }
  }

  async function addFindjobitFeed() {
    if (sources.some((source) => source.url === findjobitArgentinaFeedUrl)) {
      showToast('El feed de Findjobit ya está agregado.')
      return
    }
    setBusy(true)
    try {
      await window.radar.sources.add({
        name: 'Findjobit · empleos remotos de IT en Argentina',
        url: findjobitArgentinaFeedUrl,
        kind: 'rss',
        profileId: null,
        enabled: true,
        automationEvidenceUrl: 'https://findjobit.com/rss-feed',
        jsonConfig: null,
        csvConfig: null,
      })
      await refresh()
      showToast('Feed público de Findjobit agregado.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo agregar el feed de Findjobit.')
    } finally {
      setBusy(false)
    }
  }

  async function addDespegarJobs() {
    if (sources.some((source) => source.url === despegarArgentinaJobsUrl)) {
      showToast('La fuente de Despegar ya está agregada.')
      return
    }
    setBusy(true)
    try {
      await window.radar.sources.add({
        name: 'Despegar · empleos en Argentina',
        url: despegarArgentinaJobsUrl,
        kind: 'json',
        profileId: null,
        enabled: true,
        automationEvidenceUrl: 'https://github.com/lever/postings-api',
        jsonConfig: leverArgentinaJsonConfig(),
        csvConfig: null,
      })
      await refresh()
      showToast('Fuente pública de Despegar agregada y filtrada para Argentina.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo agregar la fuente de Despegar.')
    } finally {
      setBusy(false)
    }
  }

  async function addSmartRecruitersArgentinaSources() {
    setBusy(true)
    let added = 0
    const errors: string[] = []
    try {
      for (const policy of smartRecruitersArgentinaPolicies) {
        if (sources.some((source) => source.url === policy.url)) continue
        try {
          await window.radar.sources.add({
            name: policy.sourceName ?? policy.title,
            url: policy.url,
            kind: 'json',
            profileId: null,
            enabled: true,
            automationEvidenceUrl: policy.evidenceUrl,
            jsonConfig: smartRecruitersArgentinaJsonConfig,
            csvConfig: null,
          })
          added += 1
        } catch (error) {
          errors.push(error instanceof Error ? error.message : policy.sourceName ?? policy.title)
        }
      }
      await refresh()
      if (errors.length) {
        showToast(`Agregué ${added} fuentes de SmartRecruiters; ${errors.length} no se pudieron agregar. Revisá Fuentes.`)
      } else if (added) {
        showToast(`Agregué ${added} empresas de SmartRecruiters para Argentina.`)
      } else {
        showToast('Las fuentes recomendadas de SmartRecruiters ya están agregadas.')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron agregar las fuentes de SmartRecruiters.')
    } finally {
      setBusy(false)
    }
  }

  async function addWorkableSurJobs() {
    if (sources.some((source) => source.url === workableSurArgentinaJobsUrl)) {
      showToast('La fuente de Sur ya está agregada.')
      return
    }
    setBusy(true)
    try {
      await window.radar.sources.add({
        name: 'Sur · oportunidades en Argentina (empleador final por confirmar)',
        url: workableSurArgentinaJobsUrl,
        kind: 'json',
        profileId: null,
        enabled: true,
        automationEvidenceUrl: 'https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page',
        jsonConfig: workableArgentinaJsonConfig,
        csvConfig: null,
      })
      await refresh()
      showToast('Fuente pública de Sur agregada; solo conserva avisos de Argentina.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo agregar la fuente de Sur.')
    } finally {
      setBusy(false)
    }
  }

  async function addAdditionalLeverSources() {
    setBusy(true)
    let added = 0
    const errors: string[] = []
    try {
      for (const policy of additionalLeverArgentinaPolicies) {
        if (sources.some((source) => source.url === policy.url)) continue
        try {
          await window.radar.sources.add({
            name: policy.sourceName ?? policy.title,
            url: policy.url,
            kind: 'json',
            profileId: null,
            enabled: true,
            automationEvidenceUrl: policy.evidenceUrl,
            jsonConfig: leverArgentinaJsonConfig(),
            csvConfig: null,
          })
          added += 1
        } catch (error) {
          errors.push(error instanceof Error ? error.message : policy.sourceName ?? policy.title)
        }
      }
      await refresh()
      if (errors.length) {
        showToast(`Agregué ${added} fuentes; ${errors.length} no se pudieron agregar. Revisá Fuentes.`)
      } else if (added) {
        showToast(`Agregué ${added} fuentes de empleo en Argentina.`)
      } else {
        showToast('Las fuentes recomendadas ya están agregadas.')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron agregar las fuentes recomendadas.')
    } finally {
      setBusy(false)
    }
  }

  async function addGreenhouseArgentinaSources() {
    setBusy(true)
    let added = 0
    const errors: string[] = []
    try {
      for (const policy of greenhouseArgentinaPolicies) {
        if (sources.some((source) => source.url === policy.url)) continue
        try {
          await window.radar.sources.add({
            name: policy.sourceName ?? policy.title,
            url: policy.url,
            kind: 'json',
            profileId: null,
            enabled: true,
            automationEvidenceUrl: policy.evidenceUrl,
            jsonConfig: greenhouseArgentinaJsonConfig,
            csvConfig: null,
          })
          added += 1
        } catch (error) {
          errors.push(error instanceof Error ? error.message : policy.sourceName ?? policy.title)
        }
      }
      await refresh()
      if (errors.length) {
        showToast(`Agregué ${added} fuentes de Greenhouse; ${errors.length} no se pudieron agregar. Revisá Fuentes.`)
      } else if (added) {
        showToast(`Agregué ${added} fuentes de empleo en Argentina.`)
      } else {
        showToast('Las fuentes recomendadas de Greenhouse ya están agregadas.')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron agregar las fuentes de Greenhouse.')
    } finally {
      setBusy(false)
    }
  }

  async function addAshbyArgentinaSources() {
    setBusy(true)
    let added = 0
    const errors: string[] = []
    try {
      for (const policy of ashbyArgentinaPolicies) {
        if (sources.some((source) => source.url === policy.url)) continue
        try {
          await window.radar.sources.add({
            name: policy.sourceName ?? policy.title,
            url: policy.url,
            kind: 'json',
            profileId: null,
            enabled: true,
            automationEvidenceUrl: policy.evidenceUrl,
            jsonConfig: ashbyArgentinaJsonConfig,
            csvConfig: null,
          })
          added += 1
        } catch (error) {
          errors.push(error instanceof Error ? error.message : policy.sourceName ?? policy.title)
        }
      }
      await refresh()
      if (errors.length) {
        showToast(`Agregué ${added} fuentes de Ashby; ${errors.length} no se pudieron agregar. Revisá Fuentes.`)
      } else if (added) {
        showToast(`Agregué ${added} tableros con avisos elegibles en Argentina.`)
      } else {
        showToast('Los tableros recomendados de Ashby ya están agregados.')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron agregar las fuentes de Ashby.')
    } finally {
      setBusy(false)
    }
  }

  async function runSearch() {
    setBusy(true)
    try {
      const result = await window.radar.app.runSearch()
      await refresh()
      if (result.checkedSources === 0) {
        showToast('Agregá un feed, JSON o CSV autorizado para buscar automáticamente. Los enlaces web quedan listos para revisar.')
      } else {
        const summary = result.added
          ? `Encontré ${result.added} aviso${result.added === 1 ? '' : 's'} nuevo${result.added === 1 ? '' : 's'}.`
          : 'La búsqueda terminó; no hay avisos nuevos.'
        showToast(result.errors.length
          ? `${summary} ${result.errors.length} fuente${result.errors.length === 1 ? '' : 's'} con errores; revisá Fuentes.`
          : summary)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo completar la búsqueda.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleSource(source: UserSource) {
    if (busy) return
    setBusy(true)
    try {
      await window.radar.sources.updateEnabled(source.id, !source.enabled)
      await refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo actualizar la fuente.')
    } finally {
      setBusy(false)
    }
  }

  async function updateCustomAutomationApproval(source: UserSource) {
    const approved = !source.customAutomationApproved
    if (approved && !window.confirm(`¿Autorizar consultas automáticas a “${source.name}”? Radar consultará este endpoint cuando busques y según el intervalo programado. Confirmá que el feed es público y admite esas consultas. El servidor verá tu dirección IP; Radar no le enviará tu perfil ni tu CV. Podés revocar la autorización cuando quieras.`)) return
    try {
      await window.radar.sources.updateCustomAutomationApproval(source.id, approved)
      await refresh()
      showToast(approved
        ? 'Fuente autorizada. Sigue pausada hasta que la actives.'
        : 'Autorización revocada y fuente pausada.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo actualizar la autorización.')
    }
  }

  async function removeSource(source: UserSource) {
    if (!window.confirm(`¿Eliminar la fuente “${source.name}”?`)) return
    try {
      await window.radar.sources.remove(source.id)
      await refresh()
      showToast('Fuente eliminada.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo eliminar la fuente.')
    }
  }

  async function importResumes(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    let imported = 0
    let ocrPagesRecognized = 0
    let ocrFailures = 0
    const failures: string[] = []
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        failures.push(`${file.name}: no es un PDF`)
        continue
      }
      if (file.size > 20 * 1024 * 1024) {
        failures.push(`${file.name}: supera los 20 MB`)
        continue
      }
      try {
        const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const bytes = new Uint8Array(await file.arrayBuffer())
        // PDF.js transfers its input buffer to the worker; retain this copy for local storage.
        const loadingTask = getDocument({ data: copyPdfBytesForWorker(bytes) })
        let pageCount = 0
        let extractedText = ''
        try {
          const pdf = await loadingTask.promise
          pageCount = pdf.numPages
          if (pageCount > 100) throw new Error('supera el máximo de 100 páginas')
          const pages: string[] = []
          let ocrUnavailable = false
          for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber)
            const content = await page.getTextContent()
            const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim()
            const needsOcr = pageText.replace(/\s+/gu, '').length < 20
            if (needsOcr && ocrUnavailable) {
              ocrFailures += 1
              pages.push(pageText)
              continue
            }
            if (needsOcr) {
              let canvas: HTMLCanvasElement | null = null
              try {
                const unitViewport = page.getViewport({ scale: 1 })
                const scale = Math.min(2, Math.sqrt(4_000_000 / (unitViewport.width * unitViewport.height)))
                const viewport = page.getViewport({ scale })
                canvas = document.createElement('canvas')
                canvas.width = Math.ceil(viewport.width)
                canvas.height = Math.ceil(viewport.height)
                const context = canvas.getContext('2d', { alpha: false })
                if (!context) throw new Error('No se pudo preparar la página para OCR.')
                context.fillStyle = '#fff'
                context.fillRect(0, 0, canvas.width, canvas.height)
                await page.render({ canvas, canvasContext: context, viewport }).promise
                const png = await new Promise<Blob>((resolve, reject) => {
                  canvas?.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen de la página.')), 'image/png')
                })
                const recognized = await window.radar.resumes.ocrPage(new Uint8Array(await png.arrayBuffer()))
                if (recognized) ocrPagesRecognized += 1
                pages.push([pageText, recognized].filter(Boolean).join('\n'))
              } catch {
                ocrUnavailable = true
                ocrFailures += 1
                pages.push(pageText)
              } finally {
                if (canvas) {
                  canvas.width = 0
                  canvas.height = 0
                }
              }
            } else {
              pages.push(pageText)
            }
          }
          extractedText = pages.join('\n\n').slice(0, 500_000)
        } finally {
          await loadingTask.destroy().catch(() => {})
        }
        const name = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
        await window.radar.resumes.add({
          name,
          originalName: file.name,
          pageCount,
          extractedText,
          bytes,
        })
        imported += 1
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'no se pudo leer'}`)
      }
    }
    try {
      await refresh()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'No se pudo actualizar la lista de CV.')
    } finally {
      setBusy(false)
    }
    if (failures.length) {
      const extra = failures.length > 1 ? ` y ${failures.length - 1} más` : ''
      showToast(`${imported} CV guardado${imported === 1 ? '' : 's'}; ${failures.length} fallo${failures.length === 1 ? '' : 's'}: ${failures[0]}${extra}.`)
    }
    else if (ocrFailures) showToast(`${imported} CV guardado${imported === 1 ? '' : 's'}; no se pudo aplicar OCR local en ${ocrFailures} página${ocrFailures === 1 ? '' : 's'}.`)
    else if (ocrPagesRecognized) showToast(`${imported} CV guardado${imported === 1 ? '' : 's'}; OCR local aplicado en ${ocrPagesRecognized} página${ocrPagesRecognized === 1 ? '' : 's'}.`)
    else if (imported) showToast(`${imported} CV guardado${imported === 1 ? '' : 's'} en esta computadora.`)
  }

  async function removeResume(resume: ResumeRecord) {
    if (!window.confirm(`¿Eliminar “${resume.name}” y su copia guardada en esta computadora?`)) return
    try {
      await window.radar.resumes.remove(resume.id)
      await refresh()
      showToast('CV eliminado.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo eliminar el CV.')
    }
  }

  function openDraft(opportunity: Opportunity) {
    const existing = drafts.find((draft) => draft.opportunityId === opportunity.id)
    const resumeId = existing?.resumeId ?? resumes[0]?.id ?? ''
    setSelectedOpportunity(opportunity)
    setDraftId(existing?.id)
    setDraftResumeId(resumeId)
    setDraftResumeContent(existing?.resumeCopyText || resumes.find((resume) => resume.id === resumeId)?.extractedText || '')
    setDraftMessage(existing?.message ?? `Hola, equipo de ${opportunity.company}.\n\nQuiero postularme al puesto de ${opportunity.title}. Adjunto mi CV para que puedan conocer mi perfil. Quedo a disposición para conversar y ampliar cualquier información.\n\nSaludos.`)
    setModal('draft')
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOpportunity) return
    setBusy(true)
    try {
      const saved = await window.radar.drafts.save({
        id: draftId,
        opportunityId: selectedOpportunity.id,
        resumeId: draftResumeId || null,
        message: draftMessage,
        resumeCopyText: draftResumeContent,
      })
      if (selectedOpportunity.status === 'nueva') {
        await window.radar.opportunities.updateStatus(selectedOpportunity.id, 'revisada')
      }
      setDraftId(saved.id)
      await refresh()
      showToast('Borrador guardado. El mensaje está listo para revisar y copiar.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar el borrador.')
    } finally {
      setBusy(false)
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftMessage)
      showToast('Mensaje copiado.')
    } catch {
      showToast('No pude acceder al portapapeles. Seleccioná el texto para copiarlo.')
    }
  }

  async function generateDraftMessage() {
    if (!selectedOpportunity) return
    setBusy(true)
    try {
      const message = await window.radar.app.generateMessage({
        opportunityId: selectedOpportunity.id,
        resumeId: draftResumeId || null,
      })
      setDraftMessage(message)
      showToast('Borrador generado. Revisalo antes de enviarlo.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo generar el mensaje.')
    } finally {
      setBusy(false)
    }
  }

  async function exportResumeCopy() {
    if (!selectedOpportunity || !draftResumeId) return showToast('Elegí un CV para crear la copia.')
    setBusy(true)
    try {
      const savedPath = await window.radar.resumes.exportCopy({
        resumeId: draftResumeId,
        jobTitle: selectedOpportunity.title,
        company: selectedOpportunity.company,
        content: draftResumeContent,
      })
      if (savedPath) showToast('Copia PDF guardada. El archivo original sigue intacto.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo crear la copia del CV.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const { aiApiKeyConfigured: _keyConfigured, salaryExchangeRates: _salaryExchangeRates, ...settingsInput } = settings
      const saved = await window.radar.app.saveSettings({ ...settingsInput, aiApiKey: aiApiKeyDraft })
      setSettings(saved)
      setAiApiKeyDraft('')
      showToast('Preferencias guardadas.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron guardar las preferencias.')
    } finally {
      setBusy(false)
    }
  }

  async function refreshSalaryExchangeRates() {
    if (busy) return
    setBusy(true)
    try {
      const refreshed = await window.radar.app.refreshSalaryExchangeRates()
      setSettings((current) => ({ ...current, salaryExchangeRates: refreshed.salaryExchangeRates }))
      const date = refreshed.salaryExchangeRates?.asOf
      showToast(date ? `Cotizaciones del BCRA actualizadas al ${date}.` : 'El BCRA no publicó cotizaciones disponibles.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron actualizar las cotizaciones del BCRA.')
    } finally {
      setBusy(false)
    }
  }

  async function checkForAppUpdates() {
    if (checkingUpdates) return
    setCheckingUpdates(true)
    try {
      const next = await window.radar.app.checkForUpdates()
      setUpdateState(next)
      if (next.status !== 'checking' && next.status !== 'downloading' && next.status !== 'available') {
        showToast(next.message)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo buscar la actualización.')
    } finally {
      setCheckingUpdates(false)
    }
  }

  async function quitAndInstallUpdate() {
    try {
      await window.radar.app.quitAndInstallUpdate()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Todavía no hay una actualización lista para instalar.')
    }
  }

  async function clearAiApiKey() {
    if (busy) return
    setBusy(true)
    try {
      const saved = await window.radar.app.clearAiApiKey()
      setSettings((current) => ({ ...current, aiApiKeyConfigured: saved.aiApiKeyConfigured }))
      setAiApiKeyDraft('')
      showToast('Clave eliminada de esta computadora.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo eliminar la clave.')
    } finally {
      setBusy(false)
    }
  }

  async function importCsvOpportunities(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!csvImportContents) return showToast(csvImportFileError || 'Elegí primero un CSV local.')
    if (csvImportPreview.error) return showToast(csvImportPreview.error)
    const input: CsvLocalImportInput = {
      contents: csvImportContents,
      profileId: csvImportProfileId || null,
      sourceName: csvImportSourceName,
      config: csvImportConfig,
    }
    setBusy(true)
    try {
      const result: CsvLocalImportResult = await window.radar.opportunities.importCsv(input)
      await refresh()
      closeActiveModal()
      showToast(formatLocalImportResult(result))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo importar el CSV.')
    } finally {
      setBusy(false)
    }
  }

  async function importJsonOpportunities(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!jsonImportContents) return showToast(jsonImportFileError || 'Elegí primero un archivo JSON local.')
    if (!jsonImportPreview?.result) return showToast(jsonImportPreview?.error || 'Analizá el archivo antes de importarlo.')
    const input: JsonLocalImportInput = {
      contents: jsonImportContents,
      sourceId: jsonImportSourceId,
      profileId: jsonImportProfileId || null,
    }
    setBusy(true)
    try {
      const result: JsonLocalImportResult = await window.radar.opportunities.importJson(input)
      await refresh()
      closeActiveModal()
      showToast(formatLocalImportResult(result))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo importar el JSON local.')
    } finally {
      setBusy(false)
    }
  }

  async function createBackup() {
    setBusy(true)
    try {
      const backupPath = await window.radar.app.createBackup()
      if (backupPath) showToast(`Copia de seguridad creada en ${backupPath}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo crear la copia de seguridad.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreBackup() {
    if (!window.confirm('La restauración reemplaza los perfiles, avisos, fuentes, borradores y CV guardados en esta computadora, y reinicia Radar Laboral. ¿Querés continuar?')) return
    setBusy(true)
    try {
      const restored = await window.radar.app.restoreBackup()
      if (restored) showToast('Copia validada y restaurada. Radar Laboral se reiniciará.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo restaurar la copia.')
    } finally {
      setBusy(false)
    }
  }

  async function saveCandidateProfile() {
    setBusy(true)
    try {
      const saved = await window.radar.candidate.save(candidateProfile)
      setCandidateProfile(saved)
      showToast('Datos personales guardados en esta computadora.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron guardar los datos personales.')
    } finally {
      setBusy(false)
    }
  }

  const pageTitle: Record<PageKey, { title: string; eyebrow: string; description: string }> = {
    resumen: { title: 'Tu búsqueda, en marcha.', eyebrow: 'PANEL DE CONTROL', description: 'Encontrá avisos, prepará postulaciones y seguí cada paso desde un solo lugar.' },
    busquedas: { title: 'Perfiles de búsqueda', eyebrow: 'TUS CRITERIOS', description: 'Guardá objetivos distintos y usá un CV adecuado para cada tipo de puesto.' },
    vacantes: { title: 'Vacantes', eyebrow: 'SEGUIMIENTO', description: 'Revisá los avisos, prepará el mensaje y llevá el estado de cada postulación.' },
    cv: { title: 'Tus CV', eyebrow: 'ARCHIVOS LOCALES', description: 'Cargá varias versiones. Se procesan y guardan en esta computadora.' },
    fuentes: { title: 'Fuentes de empleo', eyebrow: 'CONECTORES', description: 'Agregá feeds RSS/Atom, APIs JSON, CSV públicos o enlaces para revisar manualmente.' },
    ajustes: { title: 'Preferencias', eyebrow: 'CONFIGURACIÓN', description: 'Elegí cuándo buscar y si querés conectar un proveedor de IA.' },
  }

  const current = pageTitle[page]
  const currentSourceTest = sourceTest?.key === sourceTestKey(sourceForm) ? sourceTest : null

  return (
    <>
    <div className="app-shell" inert={Boolean(modal)}>
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => setPage('resumen')} aria-label="Ir al resumen">
          <img className="brand-mark" src={brandIcon} alt="" />
          <span className="brand-text"><strong>radar</strong><small>laboral</small></span>
        </button>

        <div className="sidebar-caption">TU ESPACIO</div>
        <nav className="sidebar-nav" aria-label="Navegación principal">
          <NavButton icon="overview" label="Resumen" active={page === 'resumen'} onClick={() => setPage('resumen')} />
          <NavButton icon="search" label="Búsquedas" count={profiles.length} active={page === 'busquedas'} onClick={() => setPage('busquedas')} />
          <NavButton icon="briefcase" label="Vacantes" count={summary.newOpportunities} active={page === 'vacantes'} onClick={() => setPage('vacantes')} />
          <NavButton icon="file" label="Mis CV" count={resumes.length} active={page === 'cv'} onClick={() => setPage('cv')} />
          <NavButton icon="link" label="Fuentes" count={sources.length} active={page === 'fuentes'} onClick={() => setPage('fuentes')} />
        </nav>

        <div className="sidebar-footer">
          <div className="privacy-note">
            <span className="privacy-dot" />
            <div><strong>Datos en tu equipo</strong><span>Sin cuenta ni nube</span></div>
          </div>
          <button className={`nav-item ${page === 'ajustes' ? 'active' : ''}`} onClick={() => setPage('ajustes')}>
            <Icon name="settings" /><span>Preferencias</span>
          </button>
          {import.meta.env.DEV && <div className="version-note">VERSIÓN DE DESARROLLO</div>}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Radar Laboral</span><span className="breadcrumb-divider">/</span><strong>{current.title}</strong></div>
          <div className="topbar-actions">
            <div className="search-status"><span className="status-pulse" />{settings.searchIntervalHours} h <span className="status-label">· búsqueda automática</span></div>
            <button className="top-avatar" aria-label="Preferencias" onClick={() => setPage('ajustes')}>RL</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{current.eyebrow}</div>
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
            {page === 'resumen' && <button className="button button-dark" onClick={() => openProfile()}><Icon name="plus" /> Crear búsqueda <span className="button-end"><Icon name="arrow" size={16} /></span></button>}
            {page === 'busquedas' && <button className="button button-dark" onClick={() => openProfile()}><Icon name="plus" /> Nuevo perfil <span className="button-end"><Icon name="arrow" size={16} /></span></button>}
            {page === 'vacantes' && <div className="page-heading-actions"><button className="button button-outline" disabled={busy} onClick={openCsvImport}><Icon name="upload" /> Importar CSV local</button><button className="button button-outline" disabled={busy} onClick={openJsonImport}><Icon name="upload" /> Importar JSON local</button><button className="button button-dark" onClick={openOpportunity}><Icon name="plus" /> Agregar vacante <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>}
            {page === 'fuentes' && <button className="button button-dark" onClick={openSource}><Icon name="plus" /> Agregar fuente <span className="button-end"><Icon name="arrow" size={16} /></span></button>}
            {page === 'cv' && <label className="button button-dark file-cta"><Icon name="upload" /> Cargar CV <span className="button-end"><Icon name="arrow" size={16} /></span><input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { void importResumes(event.currentTarget.files); event.currentTarget.value = '' }} /></label>}
          </div>

          {loading ? <div className="loading-state"><span className="loading-orbit" />Cargando tu espacio…</div> : (
            <>
              {page === 'resumen' && <Dashboard
                summary={summary}
                searchIntervalHours={settings.searchIntervalHours}
                profiles={profiles}
                opportunities={opportunities}
                sources={sources}
                onCreateProfile={() => openProfile()}
                onCreateOpportunity={openOpportunity}
                onOpenProfiles={() => setPage('busquedas')}
                onOpenOpportunities={() => setPage('vacantes')}
                onOpenSources={() => setPage('fuentes')}
                onRunSearch={runSearch}
                busy={busy}
              />}
              {page === 'busquedas' && <ProfilesPage profiles={profiles} onCreate={() => openProfile()} onEdit={openProfile} onDelete={deleteProfile} />}
              {page === 'vacantes' && <OpportunitiesPage
                opportunities={filteredOpportunities}
                profiles={profiles}
                query={query}
                setQuery={setQuery}
                filter={statusFilter}
                setFilter={setStatusFilter}
                profileFilter={profileFilter}
                setProfileFilter={setProfileFilter}
                onAdd={openOpportunity}
                onOpen={(url) => void window.radar.app.openExternal(url)}
                onStatus={updateStatus}
                onTracking={openTracking}
                onDraft={openDraft}
                busy={busy}
              />}
              {page === 'cv' && <ResumesPage resumes={resumes} busy={busy} onUpload={importResumes} onDelete={removeResume} />}
              {page === 'fuentes' && <SourcesPage sources={sources} profiles={profiles} onAdd={openSource} onAddRecommended={addFindjobitFeed} onAddDespegar={addDespegarJobs} onAddLeverSources={addAdditionalLeverSources} onAddSmartRecruitersSources={addSmartRecruitersArgentinaSources} onAddWorkableSur={addWorkableSurJobs} onAddGreenhouseSources={addGreenhouseArgentinaSources} onAddAshbySources={addAshbyArgentinaSources} onToggle={toggleSource} onCustomAutomationApproval={updateCustomAutomationApproval} onDelete={removeSource} onSearch={runSearch} onOpen={(url) => void window.radar.app.openExternal(url)} busy={busy} />}
              {page === 'ajustes' && <SettingsPage settings={settings} setSettings={setSettings} theme={theme} onThemeChange={setTheme} candidate={candidateProfile} setCandidate={setCandidateProfile} onSaveCandidate={saveCandidateProfile} aiApiKeyDraft={aiApiKeyDraft} setAiApiKeyDraft={setAiApiKeyDraft} onClearAiApiKey={clearAiApiKey} onCreateBackup={createBackup} onRestoreBackup={restoreBackup} onRefreshSalaryExchangeRates={refreshSalaryExchangeRates} onSave={saveSettings} busy={busy} appVersion={appVersion} updateState={updateState} checkingUpdates={checkingUpdates} onCheckForUpdates={() => void checkForAppUpdates()} onQuitAndInstallUpdate={() => void quitAndInstallUpdate()} />}
            </>
          )}
        </div>
      </main>
    </div>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveModal() }}>
        {modal === 'profile' && <Modal title={editingProfileId ? 'Editar búsqueda' : 'Nueva búsqueda'} eyebrow="PERFIL LABORAL" onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={(event) => void saveProfile(event)}>
            <Field label="Nombre del perfil" hint="Un nombre corto para identificarlo."><input required maxLength={100} placeholder="Ej. Administración" value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} /></Field>
            <Field label="Describí la búsqueda" hint="Escribilo con tus palabras; se usa para ordenar y abrir búsquedas web junto con los filtros."><textarea rows={3} maxLength={2000} placeholder="Busco trabajo administrativo o de atención al cliente, con jornada completa y tareas de organización." value={profileForm.searchDescription} onChange={(event) => setProfileForm({ ...profileForm, searchDescription: event.target.value })} /></Field>
            <Field label="Puestos o rubros" hint="Filtros opcionales; separá varios con comas."><input placeholder="Administrativo, recepción" value={profileForm.roles} onChange={(event) => setProfileForm({ ...profileForm, roles: event.target.value })} /></Field>
            <div className="form-row">
              <div className="field"><span className="field-label" id="profile-locations-label">Localidades</span>
                <textarea required rows={2} aria-labelledby="profile-locations-label" placeholder="Santa Fe; Santo Tomé" value={profileForm.locations} onChange={(event) => setProfileForm({ ...profileForm, locations: event.target.value })} />
                <div className="locality-picker">
                  <label htmlFor="profile-locality-search">Agregar localidad oficial</label>
                  <input id="profile-locality-search" type="search" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={localitySuggestions.length > 0} aria-controls="profile-locality-suggestions" aria-activedescendant={localityActiveIndex >= 0 && localitySuggestions[localityActiveIndex] ? `profile-locality-option-${localitySuggestions[localityActiveIndex].id}` : undefined} placeholder="Buscar por localidad, departamento o provincia" value={localityQuery} onChange={(event) => { setLocalityQuery(event.target.value); setLocalityActiveIndex(-1) }} onKeyDown={(event) => {
                    if (!localitySuggestions.length) return
                    if (event.key === 'ArrowDown') { event.preventDefault(); setLocalityActiveIndex((current) => (current + 1) % localitySuggestions.length) }
                    else if (event.key === 'ArrowUp') { event.preventDefault(); setLocalityActiveIndex((current) => (current <= 0 ? localitySuggestions.length - 1 : current - 1)) }
                    else if (event.key === 'Enter' && localityActiveIndex >= 0 && localitySuggestions[localityActiveIndex]) { event.preventDefault(); addGeorefLocality(localitySuggestions[localityActiveIndex]) }
                    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLocalitySuggestions([]); setLocalityActiveIndex(-1) }
                  }} />
                  {localitySuggestions.length > 0 && <ul className="locality-suggestions" id="profile-locality-suggestions" role="listbox" aria-label="Localidades oficiales sugeridas">
                    {localitySuggestions.map((locality, index) => <li key={locality.id} id={`profile-locality-option-${locality.id}`} role="option" aria-selected={index === localityActiveIndex}>
                      <button type="button" onClick={() => addGeorefLocality(locality)} aria-label={`Agregar ${locality.label}, código Georef ${locality.id}`}>
                        <strong>{locality.label}</strong>
                        <small>Código Georef {locality.id} · centroide {locality.lat.toFixed(4)}, {locality.lon.toFixed(4)}</small>
                      </button>
                    </li>)}
                  </ul>}
                </div>
                <small>Una por línea o separadas por punto y coma. Indicá provincia y, si hace falta, departamento o gobierno local. Las selecciones oficiales guardan el ID Georef para distinguir centroides con el mismo nombre.</small>
              </div>
              <Field label="Radio buscado (km)" hint="0 no aplica el radio. Se compara en línea recta entre centroides de Georef; si falta una localidad inequívoca, el aviso se conserva y se marca."><input type="number" min="0" max="1000" value={profileForm.radiusKm} onChange={(event) => setProfileForm({ ...profileForm, radiusKm: Number(event.target.value) })} /></Field>
            </div>
            <div className="form-row">
              <Field label="Modalidad"><select value={profileForm.workMode} onChange={(event) => setProfileForm({ ...profileForm, workMode: event.target.value as ProfileForm['workMode'] })}><option value="indistinto">Indistinta</option><option value="presencial">Presencial</option><option value="hibrido">Híbrida</option><option value="remoto">Remota</option></select></Field>
              <Field label="Jornada u horario"><input placeholder="Completa, turnos rotativos…" value={profileForm.schedule} onChange={(event) => setProfileForm({ ...profileForm, schedule: event.target.value })} /></Field>
            </div>
            <label className="setting-row"><span><strong>Exigir coincidencia del horario</strong><small>Si lo activás, Radar omite avisos que no confirmen todos los términos del horario. Si la fuente no publica el dato, tampoco aparecerán.</small></span><input className="toggle-input" type="checkbox" disabled={!profileForm.schedule.trim()} checked={profileForm.requireScheduleMatch} onChange={(event) => setProfileForm({ ...profileForm, requireScheduleMatch: event.target.checked })} /></label>
            <Field label="Palabras deseadas" hint="Opcional. Busca palabras o frases completas para ordenar los avisos."><input placeholder="Atención al cliente, caja, stock" value={profileForm.includeKeywords} onChange={(event) => setProfileForm({ ...profileForm, includeKeywords: event.target.value })} /></Field>
            <Field label="Palabras para excluir" hint="Omite avisos con alguna palabra o frase completa; no coincide con una parte dentro de otra palabra."><input placeholder="Comisión únicamente, freelance" value={profileForm.excludeKeywords} onChange={(event) => setProfileForm({ ...profileForm, excludeKeywords: event.target.value })} /></Field>
            <div className="form-row">
              <Field label="Sueldo mínimo mensual" hint="Por defecto, si falta una cotización el aviso se conserva; también se conservan los rangos que cruzan el mínimo. Con el filtro estricto activado, solo aparecen importes comparables cuyo límite inferior alcanza el mínimo."><input type="number" min="0" placeholder="Opcional" value={profileForm.minimumSalary} onChange={(event) => setProfileForm({ ...profileForm, minimumSalary: event.target.value, requireSalaryMatch: event.target.value.trim() ? profileForm.requireSalaryMatch : false })} /></Field>
              <Field label="Moneda"><select value={profileForm.minimumSalaryCurrency} onChange={(event) => setProfileForm({ ...profileForm, minimumSalaryCurrency: event.target.value as ProfileForm['minimumSalaryCurrency'] })}>{SALARY_CURRENCIES.map((currency) => <option key={currency} value={currency}>{salaryCurrencyLabels[currency]} ({currency})</option>)}</select></Field>
            </div>
            <label className="setting-row"><span><strong>Exigir que el sueldo publicado alcance el mínimo</strong><small>Si lo activás, Radar omite avisos sin sueldo comparable, sin una cotización vigente o con un rango que no confirma que el límite inferior alcance el mínimo.</small></span><input className="toggle-input" type="checkbox" disabled={!profileForm.minimumSalary.trim()} checked={profileForm.requireSalaryMatch} onChange={(event) => setProfileForm({ ...profileForm, requireSalaryMatch: event.target.checked })} /></label>
            <div className="form-row">
              <Field label="Días remunerados por semana" hint="Para sueldos diarios. La app multiplica por días y semanas al año (52), y divide por 12 meses. Dejalo vacío si no lo sabés."><input type="number" min="0.5" max="7" step="0.5" placeholder="Opcional" value={profileForm.workDaysPerWeek} onChange={(event) => setProfileForm({ ...profileForm, workDaysPerWeek: event.target.value })} /></Field>
              <Field label="Horas remuneradas por semana" hint="Para sueldos por hora. La app multiplica por horas y semanas al año (52), y divide por 12 meses. Dejalo vacío si no lo sabés."><input type="number" min="0.25" max="168" step="0.25" placeholder="Opcional" value={profileForm.workHoursPerWeek} onChange={(event) => setProfileForm({ ...profileForm, workHoursPerWeek: event.target.value })} /></Field>
            </div>
            <label className="setting-row"><span><strong>Convertir otros sueldos con cotización del BCRA</strong><small>Al buscar, Radar usa la última referencia disponible. La fecha se guarda en el resultado; si falta una cotización, conserva el aviso sin aplicar el mínimo.</small></span><input className="toggle-input" type="checkbox" checked={profileForm.convertSalaryCurrencies} onChange={(event) => setProfileForm({ ...profileForm, convertSalaryCurrencies: event.target.checked })} /></label>
            <div className="callout callout-soft"><Icon name="check" /><p>La app organiza el aviso, el CV y el mensaje. La postulación se envía manualmente en el portal para que puedas revisar cada dato.</p></div>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar búsqueda'} <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'opportunity' && <Modal title="Guardar una vacante" eyebrow="SEGUIMIENTO MANUAL" onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={(event) => void saveOpportunity(event)}>
            <Field label="Puesto"><input required maxLength={200} placeholder="Ej. Auxiliar administrativo" value={opportunityForm.title} onChange={(event) => setOpportunityForm({ ...opportunityForm, title: event.target.value })} /></Field>
            <div className="form-row"><Field label="Empresa"><input required placeholder="Nombre de la empresa" value={opportunityForm.company} onChange={(event) => setOpportunityForm({ ...opportunityForm, company: event.target.value })} /></Field><Field label="Localidad"><input placeholder="Ciudad o zona" value={opportunityForm.location} onChange={(event) => setOpportunityForm({ ...opportunityForm, location: event.target.value })} /></Field></div>
            <Field label="Enlace del aviso"><input required type="url" placeholder="https://…" value={opportunityForm.url} onChange={(event) => setOpportunityForm({ ...opportunityForm, url: event.target.value })} /></Field>
            <div className="form-row"><Field label="Fuente"><input placeholder="Portal o sitio" value={opportunityForm.source} onChange={(event) => setOpportunityForm({ ...opportunityForm, source: event.target.value })} /></Field><Field label="Perfil relacionado"><select value={opportunityForm.profileId} onChange={(event) => setOpportunityForm({ ...opportunityForm, profileId: event.target.value })}><option value="">Sin asignar</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field></div>
            <Field label="Descripción del aviso" hint="Pegá el texto si querés conservarlo junto con el enlace."><textarea rows={4} maxLength={12000} value={opportunityForm.description} onChange={(event) => setOpportunityForm({ ...opportunityForm, description: event.target.value })} /></Field>
            <Field label="Sueldo publicado"><input placeholder="Opcional" value={opportunityForm.salaryText} onChange={(event) => setOpportunityForm({ ...opportunityForm, salaryText: event.target.value })} /></Field>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar vacante'} <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'csv-import' && <Modal title="Importar vacantes desde un archivo" eyebrow="IMPORTACIÓN LOCAL ASISTIDA" onClose={closeActiveModal} wide>
          <form className="form-stack" onSubmit={(event) => void importCsvOpportunities(event)}>
            <p className="csv-import-intro">Elegí un CSV que ya tengas en tu computadora, por ejemplo uno exportado desde un portal. Radar no abre ese sitio ni descarga datos. El archivo se lee acá y solo guarda las vacantes que selecciones en tu base local.</p>
            <Field label="Archivo CSV o TSV local" hint="Hasta 5 MB y 1000 filas de avisos. El archivo no se guarda después de importar."><input required type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => { void selectCsvImportFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></Field>
            {csvImportFileName && <p className="csv-import-filename">Archivo elegido: {csvImportFileName}{csvImportEncoding && ` · texto leído como ${csvImportEncoding}`}</p>}
            {csvImportFileError && <div className="callout callout-error" role="alert"><Icon name="close" /><p>{csvImportFileError}</p></div>}
            {csvImportContents && <>
              <Field label="Portal o procedencia"><input required maxLength={120} value={csvImportSourceName} onChange={(event) => setCsvImportSourceName(event.target.value)} placeholder="Ej. Portal de empleo municipal" /></Field>
              <div className="form-row">
                <Field label="Separador detectado; podés corregirlo"><select value={csvImportConfig.delimiter} onChange={(event) => setCsvImportConfig({ ...csvImportConfig, delimiter: event.target.value as CsvSourceConfig['delimiter'] })}><option value=",">Coma (,)</option><option value=";">Punto y coma (;)</option><option value="\t">Tabulación</option></select></Field>
                <Field label="Perfil para aplicar filtros y ranking"><select value={csvImportProfileId} onChange={(event) => setCsvImportProfileId(event.target.value)}><option value="">Sin asignar perfil</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
              </div>
              <div className="csv-import-mapping">{csvImportColumns.map(({ field, label, required }) => <Field key={field} label={label}><select required={required} value={csvImportConfig[field]} onChange={(event) => setCsvImportConfig({ ...csvImportConfig, [field]: event.target.value })}><option value="">{required ? 'Elegí un encabezado' : 'No mapear'}</option>{csvImportPreview.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></Field>)}</div>
              <div className={`callout ${csvImportPreview.error ? 'callout-error' : 'callout-success'}`} role="status" aria-live="polite"><Icon name={csvImportPreview.error ? 'close' : 'check'} /><div><p>{csvImportPreview.error || `${csvImportPreview.rowCount} filas de avisos detectadas; se pueden importar hasta 1000.`}</p>{!csvImportPreview.error && csvImportPreview.samples.length > 0 && <ul className="csv-import-samples">{csvImportPreview.samples.map((sample, index) => <li key={`${sample.url}-${index}`}><strong>{sample.title}</strong> · {sample.company}<small>{sample.url}</small></li>)}</ul>}</div></div>
              <p className="field-hint">Se omiten enlaces inválidos, filas incompletas, duplicados y avisos que el perfil descarte por sus criterios. El resultado informa cada cantidad. Sin perfil, las vacantes se agregan sin puntaje.</p>
            </>}
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={closeActiveModal}>Cancelar</button><button className="button button-dark" disabled={busy || !csvImportContents || Boolean(csvImportPreview.error)}><Icon name="upload" /> {busy ? 'Importando…' : 'Importar vacantes'} <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'json-import' && <Modal title="Importar vacantes desde un JSON" eyebrow="IMPORTACIÓN LOCAL ASISTIDA" onClose={closeActiveModal} wide>
          <form className="form-stack" onSubmit={(event) => void importJsonOpportunities(event)}>
            <p className="csv-import-intro">Elegí un archivo JSON que ya tengas. Radar usa el mapeo de una fuente JSON guardada, procesa el archivo en esta computadora y no consulta el enlace de esa fuente.</p>
            {jsonImportSources.length > 0 ? <>
              <Field label="Fuente y mapeo guardados"><select value={jsonImportSourceId} onChange={(event) => { setJsonImportSourceId(event.target.value); invalidateJsonImportPreview() }}>{jsonImportSources.map((source) => <option value={source.id} key={source.id}>{source.name} · {source.url}</option>)}</select></Field>
              <Field label="Perfil para aplicar filtros y ranking"><select value={jsonImportProfileId} onChange={(event) => { setJsonImportProfileId(event.target.value); invalidateJsonImportPreview() }}><option value="">Sin asignar perfil</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
              <Field label="Archivo JSON local" hint="Hasta 5 MB y 1000 avisos. El archivo no se conserva después de importar."><input required type="file" accept=".json,application/json" onChange={(event) => { void selectJsonImportFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></Field>
              {jsonImportFileName && <p className="csv-import-filename">Archivo elegido: {jsonImportFileName}</p>}
              {jsonImportFileError && <div className="callout callout-error" role="alert"><Icon name="close" /><p>{jsonImportFileError}</p></div>}
              {jsonImportContents && <div className="source-test-row"><span className="field-hint">La vista previa aplica las rutas guardadas, valida enlaces y muestra ejemplos; no modifica tus vacantes.</span><button type="button" className="button button-outline" disabled={previewingJsonImport || busy} onClick={() => void previewJsonOpportunities()}>{previewingJsonImport ? 'Analizando…' : 'Analizar archivo'}</button></div>}
              {jsonImportPreview?.error && <div className="callout callout-error" role="alert"><Icon name="close" /><p>{jsonImportPreview.error}</p></div>}
              {jsonImportPreview?.result && <div className="callout callout-success" role="status" aria-live="polite"><Icon name="check" /><div><p>{jsonImportPreview.result.itemCount} avisos en el archivo; {jsonImportPreview.result.mappedCount} mapeados, {jsonImportPreview.result.skipped} omitidos y {jsonImportPreview.result.filtered} fuera de los filtros. Duplicados se detectan al guardar.</p>{jsonImportPreview.result.samples.length > 0 && <ul className="csv-import-samples">{jsonImportPreview.result.samples.map((sample, index) => <li key={`${sample.url}-${index}`}><strong>{sample.title}</strong> · {sample.company}<small>{sample.url}</small></li>)}</ul>}</div></div>}
              <p className="field-hint">Los enlaces se normalizan y los avisos duplicados no se vuelven a guardar. Con un perfil, se aplican su ranking y sus exclusiones.</p>
            </> : <><div className="callout callout-soft"><Icon name="spark" /><p>Primero agregá en <strong>Fuentes</strong> una fuente JSON con sus rutas configuradas. Puede quedar en modo asistido; para esta importación no se necesita autorización remota.</p></div><button type="button" className="button button-outline" onClick={() => { closeActiveModal(); setPage('fuentes') }}>Ir a Fuentes</button></>}
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={closeActiveModal}>Cancelar</button><button className="button button-dark" disabled={busy || previewingJsonImport || !jsonImportContents || !jsonImportPreview?.result}><Icon name="upload" /> {busy ? 'Importando…' : 'Importar vacantes'} <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'source' && <Modal title="Agregar una fuente" eyebrow="FUENTES DE EMPLEO" onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={(event) => void saveSource(event)}>
            <Field label="Nombre"><input required maxLength={100} placeholder="Ej. Feed de empleos" value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} /></Field>
            <Field label="Enlace"><input type="url" required placeholder="https://…" value={sourceForm.url} onChange={(event) => { setSourceForm({ ...sourceForm, url: event.target.value, customAutomationApproved: false }); setSourceTest(null) }} /></Field>
            <Field label="Tipo de fuente"><select value={sourceForm.kind} onChange={(event) => { setSourceForm({ ...sourceForm, kind: event.target.value as SourceKind, customAutomationApproved: false }); setSourceTest(null) }}><option value="rss">Feed RSS / Atom HTTPS</option><option value="json">API JSON HTTPS pública</option><option value="csv">CSV HTTPS público</option><option value="website">Portal o página web (revisión manual)</option></select></Field>
            {(sourceForm.kind === 'rss' || sourceForm.kind === 'json' || sourceForm.kind === 'csv') && <>
              {sourceForm.kind === 'json' && <div className="json-source-mapping">
                <p className="field-hint">Indicá las rutas JSON Pointer. Ejemplo: <code>/jobs</code> para el arreglo y <code>/title</code> para el puesto; dejá vacía la ruta del arreglo si la respuesta ya es una lista. Solo se admiten fuentes públicas sin claves o credenciales en el enlace.</p>
                <Field label="Ruta del arreglo de avisos"><input value={sourceForm.jsonConfig.itemsPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, itemsPath: event.target.value } })} placeholder="/jobs (vacío si el documento es un arreglo)" /></Field>
                <div className="form-row"><Field label="Puesto"><input required value={sourceForm.jsonConfig.titlePath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, titlePath: event.target.value } })} placeholder="/title" /></Field><Field label="Enlace del aviso"><input required value={sourceForm.jsonConfig.urlPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, urlPath: event.target.value } })} placeholder="/url" /></Field></div>
                <div className="form-row"><Field label="Descripción"><input value={sourceForm.jsonConfig.descriptionPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, descriptionPath: event.target.value } })} placeholder="/description" /></Field><Field label="Empresa"><input value={sourceForm.jsonConfig.companyPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, companyPath: event.target.value } })} placeholder="/company" /></Field></div>
                <div className="form-row"><Field label="Localidad"><input value={sourceForm.jsonConfig.locationPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, locationPath: event.target.value } })} placeholder="/location" /></Field><Field label="Sueldo en texto"><input value={sourceForm.jsonConfig.salaryPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, salaryPath: event.target.value } })} placeholder="/salary" /></Field></div>
                <details className="json-salary-mapping">
                  <summary>Mapear sueldo estructurado (opcional)</summary>
                  <p className="field-hint">Usalo si la API publica mínimo, máximo, moneda y período en campos separados. Se comparan períodos mensuales, anuales, semanales y también diarios u horarios si el perfil tiene configurada su jornada remunerada.</p>
                  <div className="form-row"><Field label="Importe mínimo"><input value={sourceForm.jsonConfig.salaryMinimumPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, salaryMinimumPath: event.target.value } })} placeholder="/salary/min" /></Field><Field label="Importe máximo"><input value={sourceForm.jsonConfig.salaryMaximumPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, salaryMaximumPath: event.target.value } })} placeholder="/salary/max" /></Field></div>
                  <div className="form-row"><Field label="Moneda"><input value={sourceForm.jsonConfig.salaryCurrencyPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, salaryCurrencyPath: event.target.value } })} placeholder="/salary/currency" /></Field><Field label="Período"><input value={sourceForm.jsonConfig.salaryPeriodPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, salaryPeriodPath: event.target.value } })} placeholder="/salary/period" /></Field></div>
                </details>
                <Field label="Fecha de publicación"><input value={sourceForm.jsonConfig.publishedAtPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, publishedAtPath: event.target.value } })} placeholder="/published_at" /></Field>
                <div className="form-row"><Field label="Filtrar por esta ruta (opcional)"><input value={sourceForm.jsonConfig.filterPath} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, filterPath: event.target.value } })} placeholder="/country" /></Field><Field label="Valor exacto esperado"><input value={sourceForm.jsonConfig.filterValue} onChange={(event) => setSourceForm({ ...sourceForm, jsonConfig: { ...sourceForm.jsonConfig, filterValue: event.target.value } })} placeholder="AR" /></Field></div>
              </div>}
              {sourceForm.kind === 'csv' && <div className="json-source-mapping csv-source-mapping">
                <p className="field-hint">Usá un CSV UTF-8 con encabezados en la primera fila. Indicá el nombre exacto de cada encabezado; podés dejar opcionales vacíos. Se admiten coma, punto y coma o tabulación.</p>
                <Field label="Separador de columnas"><select value={sourceForm.csvConfig.delimiter} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, delimiter: event.target.value as CsvSourceConfig['delimiter'] } })}><option value=",">Coma (,)</option><option value=";">Punto y coma (;)</option><option value="\t">Tabulación</option></select></Field>
                <div className="form-row"><Field label="Encabezado del puesto"><input required value={sourceForm.csvConfig.titleColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, titleColumn: event.target.value } })} placeholder="title" /></Field><Field label="Encabezado del enlace"><input required value={sourceForm.csvConfig.urlColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, urlColumn: event.target.value } })} placeholder="url" /></Field></div>
                <div className="form-row"><Field label="Empresa"><input value={sourceForm.csvConfig.companyColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, companyColumn: event.target.value } })} placeholder="company" /></Field><Field label="Localidad"><input value={sourceForm.csvConfig.locationColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, locationColumn: event.target.value } })} placeholder="location" /></Field></div>
                <div className="form-row"><Field label="Descripción"><input value={sourceForm.csvConfig.descriptionColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, descriptionColumn: event.target.value } })} placeholder="description" /></Field><Field label="Sueldo en texto"><input value={sourceForm.csvConfig.salaryColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, salaryColumn: event.target.value } })} placeholder="salary" /></Field></div>
                <details className="json-salary-mapping">
                  <summary>Mapear sueldo estructurado (opcional)</summary>
                  <p className="field-hint">Usalo si el CSV publica mínimo, máximo, moneda y período en columnas separadas. Se comparan períodos mensuales, anuales, semanales y también diarios u horarios si el perfil tiene configurada su jornada remunerada.</p>
                  <div className="form-row"><Field label="Importe mínimo"><input value={sourceForm.csvConfig.salaryMinimumColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, salaryMinimumColumn: event.target.value } })} placeholder="salary_min" /></Field><Field label="Importe máximo"><input value={sourceForm.csvConfig.salaryMaximumColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, salaryMaximumColumn: event.target.value } })} placeholder="salary_max" /></Field></div>
                  <div className="form-row"><Field label="Moneda"><input value={sourceForm.csvConfig.salaryCurrencyColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, salaryCurrencyColumn: event.target.value } })} placeholder="salary_currency" /></Field><Field label="Período"><input value={sourceForm.csvConfig.salaryPeriodColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, salaryPeriodColumn: event.target.value } })} placeholder="salary_period" /></Field></div>
                </details>
                <Field label="Fecha de publicación"><input value={sourceForm.csvConfig.publishedAtColumn} onChange={(event) => setSourceForm({ ...sourceForm, csvConfig: { ...sourceForm.csvConfig, publishedAtColumn: event.target.value } })} placeholder="published_at" /></Field>
              </div>}
              <Field label="Referencia oficial (opcional)" hint="Se guarda como nota para vos. Ingresarla no habilita consultas automáticas."><input type="url" value={sourceForm.automationEvidenceUrl} onChange={(event) => setSourceForm({ ...sourceForm, automationEvidenceUrl: event.target.value })} placeholder="https://sitio.example/terminos" /></Field>
              {findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url)
                ? <div className="callout callout-soft"><Icon name="check" /><p>Política vigente de Radar: <strong>{findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url)?.title}</strong>. {findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url)?.scope} {findVerifiedSourcePolicy(sourceForm.kind, sourceForm.url)?.attribution}</p></div>
                : <>
                  <div className="callout callout-soft"><Icon name="spark" /><p>Radar no verificó una política para esta dirección. Podés guardarla en modo asistido o confirmar que el endpoint público permite consultas automáticas y autorizarlas. El servidor verá tu dirección IP; Radar no le envía tu perfil, CV ni filtros.</p></div>
                  <label className="setting-row source-auto-approval"><span><strong>Confirmo que este endpoint público permite consultas automáticas y autorizo a Radar</strong><small>La app consultará el endpoint al buscar, también según el intervalo programado. Solo se aceptan servidores HTTPS públicos; se rechazan las redirecciones.</small></span><input className="toggle-input" type="checkbox" checked={sourceForm.customAutomationApproved} onChange={(event) => setSourceForm({ ...sourceForm, customAutomationApproved: event.target.checked })} /></label>
                </>}
            </>}

            <Field label="Perfil relacionado"><select value={sourceForm.profileId} onChange={(event) => setSourceForm({ ...sourceForm, profileId: event.target.value })}><option value="">Usar todos los perfiles</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
            {isAutomaticSourceKind(sourceForm.kind) && <div className="source-test-row"><span className="field-hint">La prueba consulta solo esta URL y muestra hasta tres títulos. El servidor puede registrar tu IP; no se envían el perfil ni el CV.</span><button type="button" className="button button-outline" disabled={testingSource || busy || !sourceForm.url.trim()} onClick={() => void testSource()}>{testingSource ? 'Probando…' : sourceForm.kind === 'json' ? 'Probar JSON' : sourceForm.kind === 'csv' ? 'Probar CSV' : 'Probar feed'}</button></div>}
            {currentSourceTest && <div className={`callout ${currentSourceTest.error ? 'callout-error' : 'callout-success'}`} role="status" aria-live="polite"><Icon name={currentSourceTest.error ? 'close' : 'check'} /><p>{currentSourceTest.error || `${sourceForm.kind === 'json' ? 'JSON' : sourceForm.kind === 'csv' ? 'CSV' : 'Feed'} válido: ${currentSourceTest.result?.itemCount ?? 0} avisos.`}{currentSourceTest.result?.sampleTitles.length ? <span className="source-test-samples"> {currentSourceTest.result.sampleTitles.join(' · ')}</span> : ''}</p></div>}
            <div className="callout callout-soft"><Icon name="spark" /><p>Las fuentes verificadas por Radar se consultan según el intervalo de búsqueda. Una fuente personalizada solo se consulta si activás su autorización; podés pausarla cuando quieras. El CSV también se puede importar desde un archivo local.</p></div>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-dark" disabled={busy || testingSource}>{busy ? 'Guardando…' : 'Agregar fuente'} <span className="button-end"><Icon name="arrow" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'tracking' && selectedOpportunity && <Modal title="Seguimiento de postulación" eyebrow="REGISTRO LOCAL" onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={(event) => void saveTracking(event)}>
            <div className="draft-job-heading"><div><span>{selectedOpportunity.company}</span><h3>{selectedOpportunity.title}</h3></div></div>
            <p className="field-hint">Estas fechas y notas quedan solo en esta computadora. No se comparten con el portal ni con el proveedor de IA.</p>
            <Field label="Fecha de postulación" hint="Al pasar el estado a Postulada se completa la fecha de hoy; podés corregirla."><input type="date" value={trackingForm.appliedDate} onChange={(event) => setTrackingForm({ ...trackingForm, appliedDate: event.target.value })} /></Field>
            <Field label="Próxima fecha para retomar" hint="Opcional: por ejemplo, cuándo consultar el estado del proceso."><input type="date" value={trackingForm.followUpDate} onChange={(event) => setTrackingForm({ ...trackingForm, followUpDate: event.target.value })} /></Field>
            <Field label="Notas privadas" hint="Anotá contactos, entrevistas o próximos pasos. Hasta 5000 caracteres."><textarea rows={6} maxLength={5000} value={trackingForm.trackingNotes} onChange={(event) => setTrackingForm({ ...trackingForm, trackingNotes: event.target.value })} placeholder="Ej.: entrevista telefónica, temas a preparar, contacto…" /></Field>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar seguimiento'} <span className="button-end"><Icon name="check" size={16} /></span></button></div>
          </form>
        </Modal>}

        {modal === 'draft' && selectedOpportunity && <Modal title="Preparar postulación" eyebrow="BORRADOR EDITABLE" onClose={() => setModal(null)} wide>
          <form className="form-stack" onSubmit={(event) => void saveDraft(event)}>
            <div className="draft-job-heading"><div><span>{selectedOpportunity.company}</span><h3>{selectedOpportunity.title}</h3></div><button type="button" className="icon-button" aria-label="Abrir aviso" onClick={() => void window.radar.app.openExternal(selectedOpportunity.url)}><Icon name="external" /></button></div>
            <Field label="CV para esta postulación"><select value={draftResumeId} onChange={(event) => { const id = event.target.value; setDraftResumeId(id); setDraftResumeContent(resumes.find((resume) => resume.id === id)?.extractedText ?? '') }}><option value="">Elegir después</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name} · {resume.pageCount} pág.</option>)}</select></Field>
            <Field label="Contenido de la copia del CV" hint="Podés corregir o reordenar el texto extraído. Se genera un PDF aparte y el archivo original no se modifica."><textarea rows={8} value={draftResumeContent} onChange={(event) => setDraftResumeContent(event.target.value)} placeholder="Elegí un CV con texto para preparar una copia." /></Field>
            <div className="resume-copy-actions"><button type="button" className="button button-outline" disabled={busy || !draftResumeId} onClick={() => void exportResumeCopy()}><Icon name="file" /> Crear copia PDF</button><button type="button" className="text-button" disabled={!draftResumeId} onClick={() => setDraftResumeContent(resumes.find((resume) => resume.id === draftResumeId)?.extractedText ?? '')}>Restaurar texto del original</button></div>
            <Field label="Mensaje para enviar" hint="Podés editarlo y copiarlo al portal cuando quieras."><textarea rows={7} value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} /></Field>
            {settings.aiEnabled && <div className="resume-copy-actions"><span className="field-hint">La solicitud al proveedor incluye el aviso y el texto del CV seleccionado.</span><button type="button" className="button button-soft" disabled={busy} onClick={() => void generateDraftMessage()}><Icon name="spark" /> {busy ? 'Preparando…' : 'Redactar con IA'}</button></div>}
            <div className="modal-actions modal-actions-split"><button type="button" className="button button-quiet" onClick={() => void copyDraft()}>Copiar mensaje</button><div><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cerrar</button><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar borrador'} <span className="button-end"><Icon name="check" size={16} /></span></button></div></div>
          </form>
        </Modal>}
      </div>}

      <div key={toast.id} className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{toast.text}</div>
      {toast.text && <div className="toast-message" aria-hidden="true"><span className="toast-mark"><Icon name="check" size={15} /></span>{toast.text}</div>}
    </>
  )
}

function NavButton({ icon, label, count, active, onClick }: { icon: string; label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon} /><span>{label}</span>{typeof count === 'number' && count > 0 && <small>{count}</small>}</button>
}

function Dashboard({
  summary,
  searchIntervalHours,
  profiles,
  opportunities,
  sources,
  onCreateProfile,
  onCreateOpportunity,
  onOpenProfiles,
  onOpenOpportunities,
  onOpenSources,
  onRunSearch,
  busy,
}: {
  summary: DashboardSummary
  searchIntervalHours: number
  profiles: SearchProfile[]
  opportunities: Opportunity[]
  sources: UserSource[]
  onCreateProfile: () => void
  onCreateOpportunity: () => void
  onOpenProfiles: () => void
  onOpenOpportunities: () => void
  onOpenSources: () => void
  onRunSearch: () => void
  busy: boolean
}) {
  const recent = opportunities.slice(0, 4)
  return <div className="dashboard-stack">
    <section className="hero-panel">
      <div className="hero-copy">
        <div className="hero-kicker"><span className="hero-kicker-dot" /> RADAR PERSONAL</div>
        <h2>Una búsqueda más<br /><em>ordenada.</em></h2>
        <p>Reuní avisos de distintas fuentes, prepará cada postulación con calma y no pierdas de vista lo que ya enviaste.</p>
        <div className="hero-buttons"><button className="button button-light" onClick={profiles.length ? onRunSearch : onCreateProfile} disabled={busy}>{busy ? 'Buscando…' : profiles.length ? 'Buscar ahora' : 'Crear mi primera búsqueda'} <span className="button-end"><Icon name="arrow" size={16} /></span></button><button className="text-button text-button-light" onClick={onCreateOpportunity}>Agregar un aviso manualmente</button></div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
        <div className="orbit-core"><span /><i /></div>
        <div className="floating-note note-top"><span className="note-spark"><Icon name="spark" size={14} /></span><div><strong>Una fuente nueva</strong><small>apareció en el radar</small></div></div>
        <div className="floating-note note-bottom"><span className="note-check"><Icon name="check" size={14} /></span><div><strong>Todo en un lugar</strong><small>CV · avisos · seguimiento</small></div></div>
      </div>
      <div className="hero-foot"><span><Icon name="clock" size={15} /> Revisión automática cada {searchIntervalHours} horas</span><span className="hero-foot-separator" /><span>{sources.filter((source) => source.enabled && isAutomaticSourceKind(source.kind)).length} fuentes automáticas activas</span><button className="hero-foot-source" onClick={onOpenSources}>Administrar fuentes <Icon name="arrow" size={12} /></button></div>
    </section>

    <section className="stat-grid" aria-label="Resumen de actividad">
      <StatCard label="Perfiles activos" value={summary.activeProfiles} note="Búsquedas guardadas" accent="moss" icon="search" />
      <StatCard label="Avisos nuevos" value={summary.newOpportunities} note="Para revisar" accent="amber" icon="briefcase" />
      <StatCard label="Postulaciones" value={summary.applicationsSent} note="Enviadas por vos" accent="blue" icon="check" />
      <StatCard label="CV cargados" value={summary.resumes} note="Guardados localmente" accent="rose" icon="file" />
    </section>

    <div className="dashboard-columns">
      <section className="content-card profile-overview">
        <div className="section-heading"><div><div className="eyebrow">BÚSQUEDAS GUARDADAS</div><h2>Tus perfiles</h2></div><button className="icon-button" onClick={onOpenProfiles} aria-label="Ver perfiles"><Icon name="arrow" /></button></div>
        {profiles.length ? <div className="profile-mini-list">{profiles.slice(0, 3).map((profile) => <div className="profile-mini" key={profile.id}><span className="profile-mini-mark"><Icon name="search" size={17} /></span><div className="profile-mini-copy"><strong>{profile.name}</strong><span>{(profile.roles.slice(0, 2).join(' · ') || profile.searchDescription.slice(0, 58))} · {profile.locations.slice(0, 2).map(displayProfileLocation).join(', ')}</span></div><span className={`mini-status ${profile.active ? 'is-active' : ''}`}>{profile.active ? 'Activa' : 'Pausada'}</span></div>)}</div> : <EmptyInline icon="search" title="Todavía no creaste perfiles" detail="Definí qué puestos y zonas querés buscar." action="Crear perfil" onClick={onCreateProfile} />}
        {profiles.length > 3 && <button className="link-button" onClick={onOpenProfiles}>Ver los {profiles.length} perfiles <Icon name="arrow" size={15} /></button>}
      </section>

      <section className="content-card recent-overview">
        <div className="section-heading"><div><div className="eyebrow">ACTIVIDAD RECIENTE</div><h2>Últimas vacantes</h2></div><button className="icon-button" onClick={onOpenOpportunities} aria-label="Ver vacantes"><Icon name="arrow" /></button></div>
        {recent.length ? <div className="recent-job-list">{recent.map((opportunity) => <button className="recent-job" key={opportunity.id} onClick={onOpenOpportunities}><span className="job-company-mark">{(Array.from(opportunity.company.trim())[0] ?? '•').toUpperCase()}</span><span className="recent-job-main"><strong>{opportunity.title}</strong><small>{opportunity.company} · {opportunity.location || opportunity.source}</small></span><span className="recent-job-date">{formatDate(opportunity.createdAt)}</span></button>)}</div> : <EmptyInline icon="briefcase" title="Tu seguimiento está listo" detail="Guardá un aviso para empezar a organizar postulaciones." action="Agregar vacante" onClick={onCreateOpportunity} />}
        {recent.length > 0 && <button className="link-button" onClick={onOpenOpportunities}>Ver todas las vacantes <Icon name="arrow" size={15} /></button>}
      </section>
    </div>
  </div>
}

function StatCard({ label, value, note, accent, icon }: { label: string; value: number; note: string; accent: string; icon: string }) {
  return <article className="stat-card"><div className={`stat-icon stat-${accent}`}><Icon name={icon} size={18} /></div><div className="stat-label">{label}</div><div className="stat-value">{value.toString().padStart(2, '0')}</div><div className="stat-note">{note}</div></article>
}

function ProfilesPage({ profiles, onCreate, onEdit, onDelete }: { profiles: SearchProfile[]; onCreate: () => void; onEdit: (profile: SearchProfile) => void; onDelete: (id: string) => void }) {
  if (!profiles.length) return <EmptyPage icon="search" title="Empezá por definir qué buscás" detail="Podés crear perfiles separados para distintos puestos, horarios o localidades." action="Crear perfil de búsqueda" onClick={onCreate} />
  return <div className="profile-grid">{profiles.map((profile) => <article className="profile-card-shell" key={profile.id}><div className="profile-card"><div className="profile-card-top"><span className="profile-card-symbol"><Icon name="search" size={20} /></span><span className={`state-pill ${profile.active ? 'state-on' : 'state-off'}`}><i />{profile.active ? 'En búsqueda' : 'Pausada'}</span></div><h2>{profile.name}</h2><div className="profile-roles">{profile.roles.length ? profile.roles.map((role) => <span key={role}>{role}</span>) : <span>{profile.searchDescription.slice(0, 90)}</span>}</div><div className="profile-detail-list"><div><span className="detail-symbol">⌖</span><span>{profile.locations.join(' · ')} <small>· {profile.radiusKm} km</small></span></div><div><span className="detail-symbol">◷</span><span>{profile.schedule || 'Horario indistinto'}{profile.requireScheduleMatch ? ' · coincidencia obligatoria' : ''}</span></div><div><span className="detail-symbol">⌂</span><span>{profile.workMode === 'indistinto' ? 'Modalidad indistinta' : profile.workMode}</span></div><div><span className="detail-symbol">$</span><span>{profile.minimumSalary === null ? 'Sin sueldo mínimo' : `Mínimo ${new Intl.NumberFormat('es-AR').format(profile.minimumSalary)} ${profile.minimumSalaryCurrency}${profile.requireSalaryMatch ? ' · coincidencia obligatoria' : ' · orientativo'}`}</span></div></div><div className="profile-card-footer"><span>Postulación manual asistida</span><div><button className="small-action" onClick={() => onEdit(profile)}>Editar</button><button className="small-action danger-action" onClick={() => onDelete(profile.id)}>Eliminar</button></div></div></div></article>)}</div>
}

function OpportunitiesPage({
  opportunities,
  profiles,
  query,
  setQuery,
  filter,
  setFilter,
  profileFilter,
  setProfileFilter,
  onAdd,
  onOpen,
  onStatus,
  onTracking,
  onDraft,
  busy,
}: {
  opportunities: Opportunity[]
  profiles: SearchProfile[]
  query: string
  setQuery: (value: string) => void
  filter: 'todas' | OpportunityStatus
  setFilter: (value: 'todas' | OpportunityStatus) => void
  profileFilter: string
  setProfileFilter: (value: string) => void
  onAdd: () => void
  onOpen: (url: string) => void
  onStatus: (opportunity: Opportunity, status: OpportunityStatus) => void
  onTracking: (opportunity: Opportunity) => void
  onDraft: (opportunity: Opportunity) => void
  busy: boolean
}) {
  return <section className="content-card jobs-card">
    <div className="jobs-toolbar"><div className="filter-tabs"><button className={filter === 'todas' ? 'selected' : ''} onClick={() => setFilter('todas')}>Todas</button>{(['nueva', 'revisada', 'guardada', 'postulada', 'descartada'] as OpportunityStatus[]).map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{statusLabels[status]}</button>)}</div><div className="jobs-filters"><select className="jobs-profile-filter" aria-label="Filtrar por perfil" value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="todas">Todos los perfiles</option><option value="sin-perfil">Sin perfil</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><label className="table-search"><span>⌕</span><input placeholder="Buscar aviso, empresa o descripción" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
    {opportunities.length ? <div className="jobs-list">{opportunities.map((opportunity) => {
      const profile = profiles.find((item) => item.id === opportunity.profileId)
      return <article className="job-row" key={opportunity.id}>
        <div className="job-company-mark job-company-large">{(Array.from(opportunity.company.trim())[0] ?? '•').toUpperCase()}</div>
        <div className="job-row-info"><div className="job-title-line"><h3>{opportunity.title}</h3><StatusBadge status={opportunity.status} /></div><p>{opportunity.company} <span>·</span> {opportunity.location || 'Ubicación no indicada'} <span>·</span> {opportunity.source}</p><div className="job-row-meta"><span>{formatDate(opportunity.publishedAt ?? opportunity.createdAt)}</span>{profile && <span>Perfil: {profile.name}</span>}{opportunity.matchScore !== null && <span className="fit-score"><Icon name="spark" size={13} /> {opportunity.matchScore}% de ajuste</span>}{opportunity.appliedDate && <span>Postulada: {formatDateOnly(opportunity.appliedDate)}</span>}{opportunity.followUpDate && <span className="follow-up-date">Seguimiento: {formatDateOnly(opportunity.followUpDate)}</span>}{opportunity.trackingNotes && <span>Notas guardadas</span>}</div>{opportunity.matchReasons.length > 0 && <div className="fit-reasons">{opportunity.matchReasons.slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</div>}</div>
        <div className="job-row-actions"><button className="small-action" onClick={() => onDraft(opportunity)}>{opportunity.status === 'postulada' ? 'Ver borrador' : 'Preparar'}</button><button className="small-action follow-up-action" onClick={() => onTracking(opportunity)}>Seguimiento</button><button className="icon-button icon-button-muted" onClick={() => onOpen(opportunity.url)} aria-label="Abrir aviso"><Icon name="external" size={16} /></button><select aria-label={`Estado de ${opportunity.title}`} value={opportunity.status} disabled={busy} onChange={(event) => onStatus(opportunity, event.target.value as OpportunityStatus)}>{Object.entries(statusLabels).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select></div>
      </article>
    })}</div> : <EmptyInline icon="briefcase" title="No hay vacantes en este filtro" detail="Agregá un aviso manualmente o conectá una fuente autorizada." action="Agregar vacante" onClick={onAdd} />}
  </section>
}

function StatusBadge({ status }: { status: OpportunityStatus }) {
  return <span className={`status-badge badge-${status}`}>{statusLabels[status]}</span>
}

function ResumesPage({ resumes, busy, onUpload, onDelete }: { resumes: ResumeRecord[]; busy: boolean; onUpload: (files: FileList | null) => void; onDelete: (resume: ResumeRecord) => void }) {
  return <div className="resumes-layout">
    <section className="upload-panel">
      <div className="upload-orbit"><Icon name="file" size={23} /></div>
      <div><div className="eyebrow">ARCHIVOS PDF</div><h2>{busy ? 'Procesando tus CV…' : 'Sumá versiones de tu CV'}</h2><p>Los archivos y el texto extraído quedan guardados solo en esta computadora. Los PDF escaneados se leen con OCR local en español e inglés; el documento no se envía. Podés cargar más de uno.</p></div>
      <label className="button button-dark file-cta"><Icon name="upload" /> Elegir archivos <span className="button-end"><Icon name="arrow" size={16} /></span><input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => { onUpload(event.currentTarget.files); event.currentTarget.value = '' }} /></label>
      <div className="upload-foot"><span>PDF · hasta 20 MB por archivo</span><span>El original se conserva sin cambios</span></div>
    </section>
    <section className="content-card resume-list-card"><div className="section-heading"><div><div className="eyebrow">BIBLIOTECA PERSONAL</div><h2>CV cargados <span className="heading-count">{resumes.length.toString().padStart(2, '0')}</span></h2></div></div>
      {resumes.length ? <div className="resume-list">{resumes.map((resume) => <article className="resume-row" key={resume.id}><span className="resume-file-icon"><Icon name="file" /></span><div className="resume-info"><strong>{resume.name}</strong><span>{resume.originalName} · {resume.pageCount} {resume.pageCount === 1 ? 'página' : 'páginas'} · agregado {formatDate(resume.createdAt)}</span><details><summary>Ver texto reconocido</summary><p>{resume.extractedText || 'No se reconoció texto en este archivo. Revisá que las páginas sean legibles.'}</p></details></div><button className="icon-button danger-icon" onClick={() => onDelete(resume)} aria-label={`Eliminar ${resume.name}`}><Icon name="trash" size={16} /></button></article>)}</div> : <EmptyInline icon="file" title="Todavía no cargaste ningún CV" detail="Radar lee PDFs con texto y aplica OCR local a páginas escaneadas. Podés revisar el texto reconocido." action="Elegir archivos" onClick={() => document.getElementById('resume-upload-hidden')?.click()} />}
    </section>
    <input id="resume-upload-hidden" className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple tabIndex={-1} onChange={(event) => { onUpload(event.currentTarget.files); event.currentTarget.value = '' }} />
  </div>
}

function SourcesPage({ sources, profiles, onAdd, onAddRecommended, onAddDespegar, onAddLeverSources, onAddSmartRecruitersSources, onAddWorkableSur, onAddGreenhouseSources, onAddAshbySources, onToggle, onCustomAutomationApproval, onDelete, onSearch, onOpen, busy }: { sources: UserSource[]; profiles: SearchProfile[]; onAdd: () => void; onAddRecommended: () => void; onAddDespegar: () => void; onAddLeverSources: () => void; onAddSmartRecruitersSources: () => void; onAddWorkableSur: () => void; onAddGreenhouseSources: () => void; onAddAshbySources: () => void; onToggle: (source: UserSource) => void; onCustomAutomationApproval: (source: UserSource) => void; onDelete: (source: UserSource) => void; onSearch: () => void; onOpen: (url: string) => void; busy: boolean }) {
  const findjobitAdded = sources.some((source) => source.url === findjobitArgentinaFeedUrl)
  const despegarAdded = sources.some((source) => source.url === despegarArgentinaJobsUrl)
  const smartRecruitersSourcesAdded = smartRecruitersArgentinaPolicies.every((policy) => sources.some((source) => source.url === policy.url))
  const workableSurAdded = sources.some((source) => source.url === workableSurArgentinaJobsUrl)
  const leverSourcesAdded = additionalLeverArgentinaPolicies.every((policy) => sources.some((source) => source.url === policy.url))
  const greenhouseSourcesAdded = greenhouseArgentinaPolicies.every((policy) => sources.some((source) => source.url === policy.url))
  const ashbySourcesAdded = ashbyArgentinaPolicies.every((policy) => sources.some((source) => source.url === policy.url))
  return <div className="sources-stack">
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Más sectores · {ashbyArgentinaPolicies.length} tableros públicos de Ashby</strong><p>Rehire, Hire Hangar, ARQ, Profound, Silver.dev, Anyone AI, The Global Talent Co., Mural, Omniscient Digital, Optery, Superhuman, Go Nimbly, Luxor Technology, Cloud Accountant Staffing, Bullpen Talent, LatamCent, Abode Money y Siena AI publican puestos en distintos rubros, incluidos finanzas, operaciones, atención al cliente y tecnología. Algunas bolsas incluyen roles de sus clientes; Radar atribuye cada aviso al portal de origen, conserva el enlace directo y permite revisar allí el empleador final.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://developers.ashbyhq.com/docs/public-job-posting-api')}>Ver documentación oficial de la API <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || ashbySourcesAdded} onClick={onAddAshbySources}>{ashbySourcesAdded ? 'Ya agregadas' : `Agregar ${ashbyArgentinaPolicies.length} tableros`}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Más rubros en Argentina · {greenhouseArgentinaPolicies.length} tableros Greenhouse</strong><p>Agregá fuentes de tecnología, consumo, marketing, inmobiliario, bienestar, finanzas, operaciones, producto y servicios. Greenhouse conserva la ubicación original; cuando el tablero confirme LATAM, Radar la incluye como elegible para Argentina y aclara si no puede calcular una distancia local.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://developers.greenhouse.io/job-board.html')}>Ver documentación oficial de la API <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || greenhouseSourcesAdded} onClick={onAddGreenhouseSources}>{greenhouseSourcesAdded ? 'Ya agregadas' : `Agregar ${greenhouseArgentinaPolicies.length} tableros`}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Más vacantes argentinas · {additionalLeverArgentinaPolicies.length} tableros Lever adicionales</strong><p>Incluye Binance, Aleph, redbee, Bluelight Consulting, Handoff, Terra, Minders, RYZ Labs, Yuno, Listo, Wing Assistant, Muttdata, TrueML, doola, Sauce, Appen, Anchorage Digital y Jeeves. Sus tableros públicos cubren pagos, finanzas, ventas, atención al cliente, análisis de negocio, diseño, marketing, inteligencia artificial y tecnología; Radar conserva los avisos con país Argentina y, para doola, Sauce, Appen y Anchorage Digital, también las ubicaciones secundarias exactas revisadas. Los avisos argentinos revisados de Anchorage requieren una inducción presencial. Lever aporta la modalidad de trabajo estructurada.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://github.com/lever/postings-api')}>Ver documentación oficial de la API <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || leverSourcesAdded} onClick={onAddLeverSources}>{leverSourcesAdded ? 'Ya agregadas' : `Agregar ${additionalLeverArgentinaPolicies.length} empresas`}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Agroindustria, finanzas, salud, talento y tecnología · {smartRecruitersArgentinaPolicies.length} tableros SmartRecruiters</strong><p>Incluye Coface, Louis Dreyfus Company, PSI CRO, Miratech y Cielo. Radar conserva hasta 100 avisos activos por tablero, verifica país, estado y enlace directo; no envía postulaciones. Cielo publica empleos de talento y selección; confirmá en el aviso si el puesto presta servicios a un cliente.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://developers.smartrecruiters.com/docs/endpoints')}>Ver documentación oficial de la API <Icon name="external" size={12} /></button><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://www.coface.com/career')}>Ver empleos de Coface <Icon name="external" size={12} /></button><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://psi-cro.com/careers/')}>Ver empleos de PSI CRO <Icon name="external" size={12} /></button><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://miratechgroup.com/career/')}>Ver empleos de Miratech <Icon name="external" size={12} /></button><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://careers.cielotalent.com/en/jobs')}>Ver empleos de Cielo <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || smartRecruitersSourcesAdded} onClick={onAddSmartRecruitersSources}>{smartRecruitersSourcesAdded ? 'Ya agregadas' : `Agregar ${smartRecruitersArgentinaPolicies.length} tableros`}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Sur · vacantes para Latinoamérica en varios rubros</strong><p>El tablero oficial publica puestos para profesionales de Latinoamérica en finanzas, marketing, ventas, soporte y tecnología. Radar filtra las ubicaciones que Workable marca como Argentina, valida cada enlace directo y atribuye la fuente a Sur; confirmá el empleador final en el aviso.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page')}>Ver documentación oficial de Workable <Icon name="external" size={12} /></button><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://hiresur.com/careers.html')}>Ver vacantes de Sur <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || workableSurAdded} onClick={onAddWorkableSur}>{workableSurAdded ? 'Ya agregada' : 'Agregar fuente'}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Vacantes publicadas de Despegar · varios rubros en Argentina</strong><p>La API pública de Lever permite consultar avisos publicados. Radar filtra localmente los registros cuyo país es Argentina y conserva el enlace original de cada vacante.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://github.com/lever/postings-api')}>Ver documentación oficial de la API <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || despegarAdded} onClick={onAddDespegar}>{despegarAdded ? 'Ya agregada' : 'Agregar fuente'}</button></div>
    <div className="source-explainer source-recommended"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Feed público de Findjobit · empleos remotos de IT en Argentina</strong><p>Opcional y enfocado en tecnología; no cubre todos los rubros. Su página oficial ofrece el feed público para incluir avisos en otro feed o sitio y pide atribuir la fuente. Al agregarlo, Radar Laboral conserva esa atribución y un vínculo a sus condiciones.</p><button type="button" className="text-button source-about-link" onClick={() => onOpen('https://findjobit.com/rss-feed')}>Ver información y condiciones del feed <Icon name="external" size={12} /></button></div><button className="button button-outline" disabled={busy || findjobitAdded} onClick={onAddRecommended}>{findjobitAdded ? 'Ya agregado' : 'Agregar feed'}</button></div>
    <section className="content-card portal-search-card">
      <div className="section-heading"><div><div className="eyebrow">BÚSQUEDA MANUAL</div><h2>Explorar portales conocidos</h2></div><span className="settings-section-icon"><Icon name="external" /></span></div>
      <p className="settings-lead">Abrí el portal y buscá con sus propios filtros. Después guardá acá los avisos que quieras seguir.</p>
      <div className="portal-grid">{MANUAL_PORTALS.map((portal) => <button key={portal.url} className="portal-link-card" onClick={() => onOpen(portal.url)}><span>{portal.name}</span><Icon name="external" size={16} /></button>)}</div>
      <p className="portal-search-note">Estos accesos abren los sitios oficiales. El perfil de búsqueda se queda en esta app; no se envían palabras clave a un buscador externo. La revisión y la postulación en estos portales son manuales.</p>
    </section>
    <div className="source-explainer"><div className="source-explainer-symbol"><Icon name="spark" /></div><div><strong>Conectores configurables, con revisión manual disponible.</strong><p>Podés mapear RSS/Atom, JSON o CSV públicos. Los endpoints verificados por Radar quedan habilitados; para otra fuente, elegí si autorizás las consultas automáticas. El servidor recibe una solicitud sin tu perfil ni CV.</p></div><button className="button button-outline" disabled={busy} onClick={onSearch}><Icon name="search" /> {busy ? 'Buscando…' : 'Buscar ahora'}</button></div>
    <section className="content-card sources-card"><div className="section-heading"><div><div className="eyebrow">TUS FUENTES</div><h2>Portales y feeds</h2></div><button className="button button-soft" aria-label="Agregar una fuente personalizada" onClick={onAdd}><Icon name="plus" /> Agregar fuente</button></div>
      {sources.length ? <div className="source-list">{sources.map((source) => <article className="source-row" key={source.id}><span className={`source-mark ${source.kind}`}><Icon name={source.kind === 'website' ? 'external' : 'link'} /></span><div className="source-info"><strong>{source.name}</strong><span>{source.url}</span><small>{source.profileId ? `Perfil: ${profiles.find((profile) => profile.id === source.profileId)?.name ?? 'eliminado'}` : 'Vinculada a todos los perfiles'} · {source.kind === 'website' ? 'Enlace · revisión manual' : `${source.kind === 'rss' ? 'RSS/Atom' : source.kind.toUpperCase()} · ${source.automationApproved ? `política verificada por Radar${source.automationPolicyReviewedOn ? ` (${source.automationPolicyReviewedOn})` : ''}` : source.customAutomationApproved ? 'consultas automáticas autorizadas por vos' : 'modo asistido'}`}</small><SourceHealth source={source} onOpen={onOpen} onCustomAutomationApproval={onCustomAutomationApproval} /></div><div className="source-row-actions"><button className={`toggle-switch ${source.enabled ? 'on' : ''}`} aria-label={source.enabled ? 'Pausar fuente' : 'Activar fuente'} disabled={isAutomaticSourceKind(source.kind) && !source.automationApproved && !source.customAutomationApproved && !source.enabled} onClick={() => onToggle(source)}><span /></button><button className="icon-button icon-button-muted" onClick={() => onOpen(source.url)} aria-label="Abrir fuente"><Icon name="external" size={16} /></button><button className="icon-button danger-icon" onClick={() => onDelete(source)} aria-label={`Eliminar ${source.name}`}><Icon name="trash" size={16} /></button></div></article>)}</div> : <EmptyInline icon="link" title="Todavía no agregaste fuentes" detail="Podés guardar RSS/Atom, una fuente JSON o CSV pública, o agregar un portal para revisarlo a mano." action="Agregar fuente" onClick={onAdd} />}
    </section>
  </div>
}

function SourceHealth({ source, onOpen, onCustomAutomationApproval }: { source: UserSource; onOpen: (url: string) => void; onCustomAutomationApproval: (source: UserSource) => void }) {
  const formatDateTime = (value: string | null) => {
    if (!value) return 'Sin fecha'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
  }
  if (source.kind === 'website') return null
  if (!source.automationApproved && !source.customAutomationApproved) return <>
    <span className="source-health-error">Modo asistido: Radar no consulta esta fuente automáticamente. Podés probar el formato al agregarla y cambiar la autorización en cualquier momento.</span>
    <button type="button" className="text-button source-policy-link" aria-label={`Autorizar consultas automáticas para ${source.name}`} onClick={() => onCustomAutomationApproval(source)}>Autorizar consultas automáticas</button>
  </>
  if (source.customAutomationApproved && !source.enabled) return <>
    <span className="source-health-ok">Fuente pausada. No se consulta automáticamente.</span>
    <button type="button" className="text-button source-policy-link" aria-label={`Revocar autorización automática para ${source.name}`} onClick={() => onCustomAutomationApproval(source)}>Revocar autorización</button>
  </>
  if (!source.enabled) return <span className="source-health-ok">Fuente pausada. No se consulta automáticamente.</span>
  return <>
    {source.lastError
      ? <span className="source-health-error" role="status">Fallo el {formatDateTime(source.lastAttemptAt)}. Último éxito: {formatDateTime(source.lastCheckedAt)}. {source.lastError}</span>
      : source.lastCheckedAt
        ? <span className="source-health-ok">Disponible. Última consulta: {formatDateTime(source.lastCheckedAt)}.</span>
        : <span className="source-health-ok">Pendiente de la primera consulta.</span>}
    {source.automationEvidenceUrl && <button type="button" className="text-button source-policy-link" onClick={() => onOpen(source.automationEvidenceUrl)}>{source.automationApproved ? 'Ver política oficial verificada' : 'Abrir referencia aportada'}</button>}
    {!source.automationApproved && <button type="button" className="text-button source-policy-link" aria-label={`Revocar autorización automática para ${source.name}`} onClick={() => onCustomAutomationApproval(source)}>Revocar autorización</button>}
  </>
}

function SettingsPage({ settings, setSettings, theme, onThemeChange, candidate, setCandidate, onSaveCandidate, aiApiKeyDraft, setAiApiKeyDraft, onClearAiApiKey, onCreateBackup, onRestoreBackup, onRefreshSalaryExchangeRates, onSave, busy, appVersion, updateState, checkingUpdates, onCheckForUpdates, onQuitAndInstallUpdate }: {
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
  theme: AppearanceTheme
  onThemeChange: (theme: AppearanceTheme) => void
  candidate: CandidateProfile
  setCandidate: (profile: CandidateProfile) => void
  onSaveCandidate: () => void
  aiApiKeyDraft: string
  setAiApiKeyDraft: (value: string) => void
  onClearAiApiKey: () => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
  onRefreshSalaryExchangeRates: () => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  busy: boolean
  appVersion: string
  updateState: AppUpdateState | null
  checkingUpdates: boolean
  onCheckForUpdates: () => void
  onQuitAndInstallUpdate: () => void
}) {
  const salaryRateCount = settings.salaryExchangeRates
    ? Object.keys(settings.salaryExchangeRates.arsPerUnit).filter((currency) => currency !== 'ARS').length
    : 0
  return <form className="settings-layout" onSubmit={onSave}>
    <section className="content-card settings-card appearance-card"><div className="section-heading"><div><div className="eyebrow">APARIENCIA</div><h2>Un espacio a tu gusto</h2></div><span className="settings-section-icon"><Icon name="spark" /></span></div><p className="settings-lead">Elegí el tema que te resulte más cómodo. El cambio se aplica al instante y queda guardado en esta computadora.</p>
      <div className="setting-row appearance-row"><span><strong>Tema de la aplicación</strong><small>Podés cambiarlo cuando quieras; no afecta tus datos.</small></span><button type="button" className={`theme-switch ${theme === 'dark' ? 'is-dark' : ''}`} role="switch" aria-checked={theme === 'dark'} aria-label="Tema oscuro" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}><span className="theme-switch-label">{theme === 'dark' ? 'Oscuro' : 'Claro'}</span><span className="theme-switch-track"><span className="theme-switch-thumb"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={13} /></span></span></button></div>
    </section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">AUTOMATIZACIÓN</div><h2>Cuándo buscar</h2></div><span className="settings-section-icon"><Icon name="clock" /></span></div><p className="settings-lead">La app revisa tus fuentes automáticas mientras está abierta o minimizada en la bandeja de Windows.</p>
      <label className="setting-row"><span><strong>Frecuencia de búsqueda</strong><small>Si la computadora está apagada, se retoma al abrir la app.</small></span><select value={settings.searchIntervalHours} onChange={(event) => setSettings({ ...settings, searchIntervalHours: Number(event.target.value) })}><option value={4}>Cada 4 horas</option><option value={8}>Cada 8 horas</option><option value={12}>Cada 12 horas</option><option value={24}>Una vez al día</option></select></label>
      <label className="setting-row"><span><strong>Buscar aunque Radar esté cerrado</strong><small>Windows abrirá Radar minimizado al iniciar sesión y lo reactivará según el intervalo. Usa esta cuenta, sin contraseña ni privilegios de administrador; requiere instalar la app.</small></span><input className="toggle-input" type="checkbox" checked={settings.backgroundSearchEnabled} onChange={(event) => setSettings({ ...settings, backgroundSearchEnabled: event.target.checked })} /></label>
    </section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">FILTRO SALARIAL</div><h2>Cotizaciones de referencia</h2></div><span className="settings-section-icon"><Icon name="spark" /></span></div><p className="settings-lead">Al actualizar, Radar consulta la API pública del BCRA; no envía tus perfiles, CV ni avisos. Solo se usan estas cotizaciones en perfiles que activen la conversión. Si el dato falta o tiene más de siete días, la vacante se conserva sin aplicar el mínimo.</p><div className="form-row"><button type="button" className="button button-soft" disabled={busy} onClick={onRefreshSalaryExchangeRates}>{busy ? 'Actualizando…' : 'Actualizar cotizaciones'}</button><span className="settings-lead">{settings.salaryExchangeRates ? `Último dato: ${settings.salaryExchangeRates.asOf} · ${salaryRateCount} monedas` : 'Todavía no hay cotizaciones guardadas.'}</span></div></section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">DATOS LOCALES</div><h2>Copias de seguridad</h2></div><span className="settings-section-icon"><Icon name="file" /></span></div><p className="settings-lead">La copia incluye la base de datos y tus CV. Guardala en una carpeta segura: contiene información personal.</p><div className="form-row"><button type="button" className="button button-soft" disabled={busy} onClick={onCreateBackup}>Crear copia de seguridad</button><button type="button" className="button button-outline" disabled={busy} onClick={onRestoreBackup}>Restaurar desde una copia</button></div><p className="settings-lead">La restauración valida la base y los PDF antes de reemplazar los datos locales; al terminar reinicia la app. La clave de IA cifrada se puede recuperar en el mismo perfil de Windows.</p></section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">DATOS CONFIRMADOS</div><h2>Mi perfil</h2></div><span className="settings-section-icon"><Icon name="file" /></span></div><p className="settings-lead">Guardá solo datos que quieras reutilizar en mensajes y copias del CV. Se quedan en esta computadora.</p>
      <div className="form-row">
        <Field label="Nombre completo"><input maxLength={160} value={candidate.fullName} onChange={(event) => setCandidate({ ...candidate, fullName: event.target.value })} /></Field>
        <Field label="Correo electrónico"><input type="email" maxLength={250} value={candidate.email} onChange={(event) => setCandidate({ ...candidate, email: event.target.value })} /></Field>
      </div>
      <div className="form-row">
        <Field label="Teléfono"><input maxLength={80} value={candidate.phone} onChange={(event) => setCandidate({ ...candidate, phone: event.target.value })} /></Field>
        <Field label="Localidad"><input maxLength={160} value={candidate.location} onChange={(event) => setCandidate({ ...candidate, location: event.target.value })} /></Field>
      </div>
      <div className="form-row">
        <Field label="Disponibilidad"><input maxLength={300} placeholder="Inmediata, jornada completa…" value={candidate.availability} onChange={(event) => setCandidate({ ...candidate, availability: event.target.value })} /></Field>
        <Field label="Movilidad u otros datos"><input maxLength={300} placeholder="Licencia, movilidad propia…" value={candidate.mobility} onChange={(event) => setCandidate({ ...candidate, mobility: event.target.value })} /></Field>
      </div>
      <Field label="Resumen confirmado"><textarea rows={3} maxLength={2000} value={candidate.summary} onChange={(event) => setCandidate({ ...candidate, summary: event.target.value })} placeholder="Información breve que ya aparece en tu CV o que querés confirmar." /></Field>
      <Field label="Otros datos confirmados"><textarea rows={3} maxLength={2000} value={candidate.additionalFacts} onChange={(event) => setCandidate({ ...candidate, additionalFacts: event.target.value })} placeholder="Por ejemplo, preferencias de horario o tareas que querés destacar." /></Field>
      <div className="settings-save-row"><span>{candidate.updatedAt ? `Actualizado ${formatDate(candidate.updatedAt)}` : 'Todavía no guardaste estos datos.'}</span><button type="button" className="button button-soft" disabled={busy} onClick={() => void onSaveCandidate()}>{busy ? 'Guardando…' : 'Guardar mi perfil'} <span className="button-end"><Icon name="check" size={16} /></span></button></div>
    </section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">ASISTENCIA OPCIONAL</div><h2>Inteligencia artificial</h2></div><span className="settings-section-icon settings-ai"><Icon name="spark" /></span></div><p className="settings-lead">La IA solo se usa cuando pedís redactar un mensaje. La app no envía postulaciones.</p>
      <label className="setting-row"><span><strong>Activar redacción asistida</strong><small>Requiere una API compatible con el formato de chat de OpenAI.</small></span><input className="toggle-input" type="checkbox" checked={settings.aiEnabled} onChange={(event) => setSettings({ ...settings, aiEnabled: event.target.checked })} /></label>
      {settings.aiEnabled && <div className="ai-provider-fields">
        <label className="provider-field"><span>Dirección de API compatible</span><input required value={settings.aiBaseUrl} onChange={(event) => setSettings({ ...settings, aiBaseUrl: event.target.value })} placeholder="https://api.openai.com/v1" autoComplete="off" /></label>
        <label className="provider-field"><span>Identificador del modelo</span><input required value={settings.aiModel} onChange={(event) => setSettings({ ...settings, aiModel: event.target.value })} placeholder="Nombre del modelo en tu proveedor" autoComplete="off" /></label>
        <label className="provider-field"><span>Clave API <small>(opcional para servidores locales)</small></span><input type="password" value={aiApiKeyDraft} onChange={(event) => setAiApiKeyDraft(event.target.value)} placeholder={settings.aiApiKeyConfigured ? 'Clave guardada · vacío conserva la actual' : 'Pegá tu clave API'} autoComplete="new-password" /></label>
        {settings.aiApiKeyConfigured && <button type="button" className="text-button danger-text-button" onClick={onClearAiApiKey}>Eliminar clave guardada</button>}
      </div>}
      <div className="privacy-banner"><span className="privacy-banner-dot" /><p><strong>La clave se cifra en Windows.</strong> Al generar un mensaje, el aviso, el CV elegido y los datos confirmados de Mi perfil se envían al proveedor. Puede haber cargos según tu cuenta; revisá el resultado antes de usarlo.</p></div>
    </section>
    <section className="content-card settings-card"><div className="section-heading"><div><div className="eyebrow">ACTUALIZACIÓN</div><h2>Versión de la app</h2></div><span className="settings-section-icon"><Icon name="arrow" /></span></div><p className="settings-lead">Radar Laboral busca actualizaciones publicadas en GitHub Releases. Si hay una nueva versión, la descarga y la instala al salir, sin interrumpir tu trabajo.</p>
      <div className="form-row"><button type="button" className="button button-soft" disabled={busy || checkingUpdates || updateState?.status === "downloading"} onClick={onCheckForUpdates}>{checkingUpdates || updateState?.status === "checking" ? "Buscando…" : "Buscar actualizaciones"}</button>{updateState?.status === "downloaded" && <button type="button" className="button button-dark" disabled={busy} onClick={onQuitAndInstallUpdate}>Instalar y salir <span className="button-end"><Icon name="check" size={16} /></span></button>}</div>
      <p className="settings-lead" role="status">{updateState ? updateState.message : "Consultando el estado de actualización…"}</p>
      {updateState?.status === "downloading" && <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={updateState.percent ?? 0}><div className="update-progress-bar" style={{ width: `${updateState.percent ?? 0}%` }} /></div>}
    </section>
    <div className="settings-save-row"><span>Los cambios se aplican a esta computadora.</span><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar preferencias'} <span className="button-end"><Icon name="check" size={16} /></span></button></div>
    <p className="version-line">Radar Laboral {appVersion || '…'}</p>
  </form>
}

function EmptyInline({ icon, title, detail, action, onClick }: { icon: string; title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="empty-inline"><span className="empty-icon"><Icon name={icon} size={19} /></span><div><strong>{title}</strong><p>{detail}</p></div><button className="small-action" onClick={onClick}>{action} <Icon name="arrow" size={14} /></button></div>
}

function EmptyPage({ icon, title, detail, action, onClick }: { icon: string; title: string; detail: string; action: string; onClick: () => void }) {
  return <section className="empty-page-card"><span className="empty-page-mark"><Icon name={icon} size={24} /></span><h2>{title}</h2><p>{detail}</p><button className="button button-dark" onClick={onClick}>{action} <span className="button-end"><Icon name="arrow" size={16} /></span></button></section>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    return activateModalFocus(dialog, () => closeRef.current())
  }, [])

  return <section ref={dialogRef} className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}><header className="modal-header"><div><div className="eyebrow">{eyebrow}</div><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></header><div className="modal-body">{children}</div></section>
}

export default App
