export type WorkMode = 'presencial' | 'hibrido' | 'remoto' | 'indistinto'
export const SALARY_CURRENCIES = [
  'ARS', 'USD', 'EUR', 'GBP', 'BRL', 'CLP', 'UYU', 'PEN', 'COP', 'MXN', 'CAD', 'AUD', 'JPY', 'CHF',
  'AWG', 'BOB', 'CNH', 'CNY', 'CZK', 'DKK', 'HKD', 'ILS', 'INR', 'NIO', 'NOK', 'NZD', 'PYG', 'RSD', 'RUB',
  'SEK', 'SGD', 'TRY', 'VND', 'ZAR',
] as const
export type SalaryCurrency = typeof SALARY_CURRENCIES[number]

export interface SalaryExchangeRateSnapshot {
  source: 'BCRA'
  asOf: string
  fetchedAt: string
  arsPerUnit: Partial<Record<SalaryCurrency, number>>
}

export type OpportunityStatus =
  | 'nueva'
  | 'revisada'
  | 'guardada'
  | 'postulada'
  | 'descartada'

export interface SearchProfile {
  id: string
  name: string
  searchDescription: string
  roles: string[]
  locations: string[]
  radiusKm: number
  includeKeywords: string[]
  excludeKeywords: string[]
  workMode: WorkMode
  schedule: string
  requireScheduleMatch: boolean
  workDaysPerWeek: number | null
  workHoursPerWeek: number | null
  minimumSalary: number | null
  minimumSalaryCurrency: SalaryCurrency
  requireSalaryMatch: boolean
  convertSalaryCurrencies: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export type SearchProfileInput = Omit<SearchProfile, 'id' | 'createdAt' | 'updatedAt'>

export interface GeorefLocalitySuggestion {
  id: string
  label: string
  lat: number
  lon: number
}

export interface ResumeRecord {
  id: string
  name: string
  originalName: string
  pageCount: number
  extractedText: string
  createdAt: string
}

export interface CandidateProfile {
  fullName: string
  email: string
  phone: string
  location: string
  availability: string
  mobility: string
  summary: string
  additionalFacts: string
  updatedAt: string | null
}

export type CandidateProfileInput = Omit<CandidateProfile, 'updatedAt'>

export interface ResumeInput {
  name: string
  originalName: string
  pageCount: number
  extractedText: string
  bytes: Uint8Array
}

export type SourceKind = 'rss' | 'json' | 'csv' | 'website'

export interface JsonSourceConfig {
  itemsPath: string
  titlePath: string
  urlPath: string
  descriptionPath: string
  companyPath: string
  locationPath: string
  salaryPath: string
  salaryMinimumPath: string
  salaryMaximumPath: string
  salaryCurrencyPath: string
  salaryPeriodPath: string
  publishedAtPath: string
  filterPath: string
  filterValue: string
}

export interface CsvSourceConfig {
  delimiter: ',' | ';' | '\t'
  titleColumn: string
  urlColumn: string
  descriptionColumn: string
  companyColumn: string
  locationColumn: string
  salaryColumn: string
  salaryMinimumColumn: string
  salaryMaximumColumn: string
  salaryCurrencyColumn: string
  salaryPeriodColumn: string
  publishedAtColumn: string
}

export interface UserSource {
  id: string
  name: string
  url: string
  kind: SourceKind
  jsonConfig: JsonSourceConfig | null
  csvConfig: CsvSourceConfig | null
  profileId: string | null
  enabled: boolean
  automationApproved: boolean
  customAutomationApproved: boolean
  automationPolicyId: string | null
  automationPolicyReviewedOn: string | null
  automationEvidenceUrl: string
  lastCheckedAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  createdAt: string
}

export type UserSourceInput = Pick<UserSource, 'name' | 'url' | 'kind' | 'profileId' | 'enabled' | 'automationEvidenceUrl' | 'jsonConfig' | 'csvConfig'>
  & Partial<Pick<UserSource, 'customAutomationApproved'>>

export interface FeedTestResult {
  itemCount: number
  sampleTitles: string[]
}

export interface CsvLocalImportInput {
  contents: string
  profileId: string | null
  sourceName: string
  config: CsvSourceConfig
}

export interface CsvLocalImportResult {
  added: number
  duplicates: number
  skipped: number
  filtered: number
}

export interface JsonLocalImportInput {
  contents: string
  sourceId: string
  profileId: string | null
}

export interface JsonLocalImportSample {
  title: string
  company: string
  url: string
}

export interface JsonLocalImportPreview {
  itemCount: number
  mappedCount: number
  skipped: number
  filtered: number
  samples: JsonLocalImportSample[]
}

export type JsonLocalImportResult = CsvLocalImportResult

export interface Opportunity {
  id: string
  profileId: string | null
  title: string
  company: string
  location: string
  source: string
  url: string
  description: string
  salaryText: string
  matchScore: number | null
  matchReasons: string[]
  missingRequirements: string[]
  status: OpportunityStatus
  appliedDate: string | null
  followUpDate: string | null
  trackingNotes: string
  discoveredAt: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OpportunityInput = Pick<
  Opportunity,
  'profileId' | 'title' | 'company' | 'location' | 'source' | 'url' | 'description' | 'salaryText'
> & Partial<Pick<Opportunity, 'matchScore' | 'matchReasons' | 'missingRequirements' | 'publishedAt'>>

export interface OpportunityTrackingInput {
  appliedDate: string | null
  followUpDate: string | null
  trackingNotes: string
}

export interface DashboardSummary {
  activeProfiles: number
  activeSources: number
  newOpportunities: number
  applicationsSent: number
  resumes: number
}

export interface SearchRunResult {
  added: number
  checkedSources: number
  errors: Array<{ sourceId: string; sourceName: string; message: string }>
  truncated: Array<{ sourceId: string; sourceName: string; message: string }>
}

export interface SearchCompletionCounts {
  added: number
  errors: number
  truncated?: number
}

export interface ApplicationDraft {
  id: string
  opportunityId: string
  resumeId: string | null
  message: string
  resumeCopyText: string
  createdAt: string
  updatedAt: string
}

export type ApplicationDraftInput = Pick<
  ApplicationDraft,
  'opportunityId' | 'resumeId' | 'message' | 'resumeCopyText'
> & { id?: string }

export interface AppSettings {
  searchIntervalHours: number
  backgroundSearchEnabled: boolean
  aiEnabled: boolean
  aiBaseUrl: string
  aiModel: string
  aiApiKeyConfigured: boolean
  salaryExchangeRates: SalaryExchangeRateSnapshot | null
}

export type AppSettingsInput = Omit<AppSettings, 'aiApiKeyConfigured' | 'salaryExchangeRates'> & { aiApiKey?: string }

export type AppUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  version: string | null
  percent: number | null
  message: string
  detail: string | null
}

export interface GenerateMessageInput {
  opportunityId: string
  resumeId: string | null
}

export interface ExportResumeCopyInput {
  resumeId: string
  jobTitle: string
  company: string
  content: string
}

export interface RadarApi {
  geography: {
    searchLocalities(query: string): Promise<GeorefLocalitySuggestion[]>
  }
  profiles: {
    list(): Promise<SearchProfile[]>
    save(profile: SearchProfileInput & { id?: string }): Promise<SearchProfile>
    remove(id: string): Promise<void>
  }
  candidate: {
    get(): Promise<CandidateProfile>
    save(profile: CandidateProfileInput): Promise<CandidateProfile>
  }
  opportunities: {
    list(): Promise<Opportunity[]>
    add(opportunity: OpportunityInput): Promise<Opportunity>
    importCsv(input: CsvLocalImportInput): Promise<CsvLocalImportResult>
    previewJsonImport(input: JsonLocalImportInput): Promise<JsonLocalImportPreview>
    importJson(input: JsonLocalImportInput): Promise<JsonLocalImportResult>
    updateStatus(id: string, status: OpportunityStatus): Promise<Opportunity>
    updateTracking(id: string, input: OpportunityTrackingInput): Promise<Opportunity>
    remove(id: string): Promise<void>
  }
  resumes: {
    list(): Promise<ResumeRecord[]>
    ocrPage(image: Uint8Array): Promise<string>
    add(resume: ResumeInput): Promise<ResumeRecord>
    remove(id: string): Promise<void>
    exportCopy(input: ExportResumeCopyInput): Promise<string | null>
  }
  sources: {
    list(): Promise<UserSource[]>
    add(source: UserSourceInput): Promise<UserSource>
    testRss(url: string): Promise<FeedTestResult>
    testJson(url: string, config: JsonSourceConfig): Promise<FeedTestResult>
    testCsv(url: string, config: CsvSourceConfig): Promise<FeedTestResult>
    updateEnabled(id: string, enabled: boolean): Promise<UserSource>
    updateCustomAutomationApproval(id: string, approved: boolean): Promise<UserSource>
    remove(id: string): Promise<void>
  }
  drafts: {
    list(): Promise<ApplicationDraft[]>
    save(draft: ApplicationDraftInput): Promise<ApplicationDraft>
    remove(id: string): Promise<void>
  }
  app: {
    version(): Promise<string>
    updateStatus(): Promise<AppUpdateState>
    checkForUpdates(): Promise<AppUpdateState>
    quitAndInstallUpdate(): Promise<void>
    onUpdateState(callback: (state: AppUpdateState) => void): () => void
    summary(): Promise<DashboardSummary>
    settings(): Promise<AppSettings>
    saveSettings(settings: AppSettingsInput): Promise<AppSettings>
    refreshSalaryExchangeRates(): Promise<AppSettings>
    clearAiApiKey(): Promise<AppSettings>
    generateMessage(input: GenerateMessageInput): Promise<string>
    runSearch(): Promise<SearchRunResult>
    createBackup(): Promise<string | null>
    restoreBackup(): Promise<boolean | null>
    onSearchCompleted(callback: () => void): () => void
    onSearchCompletionNotice(callback: (counts: SearchCompletionCounts) => void): () => void
    onSearchFailed(callback: (count: number) => void): () => void
    onFollowUpReminder(callback: (count: number, deliveryId: string) => void): () => void
    acknowledgeFollowUpReminder(deliveryId: string): void
    openExternal(url: string): Promise<void>
  }
}
