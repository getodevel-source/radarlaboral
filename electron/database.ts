import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  AppSettingsInput,
  ApplicationDraft,
  ApplicationDraftInput,
  CandidateProfile,
  CandidateProfileInput,
  DashboardSummary,
  Opportunity,
  OpportunityInput,
  OpportunityStatus,
  OpportunityTrackingInput,
  ResumeInput,
  ResumeRecord,
  SearchProfile,
  SearchProfileInput,
  SalaryExchangeRateSnapshot,
  SourceKind,
  UserSource,
  UserSourceInput,
} from '../src/shared/types'
import { validateJsonSourceConfig } from './connectors/json-feed.ts'
import { validateCsvSourceConfig } from './connectors/csv-feed.ts'
import { localDateString } from '../src/shared/local-date.ts'
import { validateOpportunityTracking } from '../src/shared/opportunity-tracking.ts'
import { isSalaryExchangeRateSnapshot } from '../src/shared/salary-exchange-rates.ts'
import { findVerifiedSourcePolicy, findVerifiedSourcePolicyById, verifiedSourcePolicyMatchesJsonConfig } from '../src/shared/verified-source-policies.ts'
import { urlCarriesSecret } from '../src/shared/source-url-secrets.ts'

import type { DueFollowUpReminder } from './follow-up-notifications.ts'

type ProfileRow = {
  id: string
  name: string
  search_description: string
  roles: string
  locations: string
  radius_km: number
  include_keywords: string
  exclude_keywords: string
  work_mode: SearchProfile['workMode']
  schedule: string
  require_schedule_match: number
  work_days_per_week: number | null
  work_hours_per_week: number | null
  minimum_salary: number | null
  minimum_salary_currency: SearchProfile['minimumSalaryCurrency']
  require_salary_match: number
  convert_salary_currencies: number
  active: number
  created_at: string
  updated_at: string
}

type CandidateRow = {
  full_name: string
  email: string
  phone: string
  location: string
  availability: string
  mobility: string
  summary: string
  additional_facts: string
  updated_at: string
}

type ResumeRow = {
  id: string
  name: string
  original_name: string
  stored_path: string
  page_count: number
  extracted_text: string
  created_at: string
}

type OpportunityRow = {
  id: string
  profile_id: string | null
  title: string
  company: string
  location: string
  source: string
  url: string
  description: string
  salary_text: string
  match_score: number | null
  match_reasons: string
  missing_requirements: string
  status: OpportunityStatus
  applied_date: string | null
  follow_up_date: string | null
  tracking_notes: string
  discovered_at: string
  published_at: string | null
  created_at: string
  updated_at: string
}

type SourceRow = {
  id: string
  name: string
  url: string
  kind: SourceKind
  profile_id: string | null
  enabled: number
  automation_approved: number
  custom_automation_approved: number
  verified_policy_id: string | null
  automation_evidence_url: string
  config_json: string
  last_checked_at: string | null
  last_attempt_at: string | null
  last_error: string | null
  created_at: string
}

type DraftRow = {
  id: string
  opportunity_id: string
  resume_id: string | null
  message: string
  resume_copy_text: string
  created_at: string
  updated_at: string
}

const now = () => new Date().toISOString()
function validWorkDaysPerWeek(value: number | null | undefined) {
  if (value == null) return null
  if (!Number.isFinite(value) || value < 0.5 || value > 7 || !Number.isInteger(value * 2)) {
    throw new Error('Los días remunerados por semana deben ser un valor entre 0,5 y 7 en incrementos de 0,5.')
  }
  return value
}

function validWorkHoursPerWeek(value: number | null | undefined) {
  if (value == null) return null
  if (!Number.isFinite(value) || value < 0.25 || value > 168 || !Number.isInteger(value * 4)) {
    throw new Error('Las horas remuneradas por semana deben ser un valor entre 0,25 y 168 en incrementos de 0,25.')
  }
  return value
}

const parseList = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const profileFromRow = (row: ProfileRow): SearchProfile => ({
  id: row.id,
  name: row.name,
  searchDescription: row.search_description ?? '',
  roles: parseList(row.roles),
  locations: parseList(row.locations),
  radiusKm: row.radius_km,
  includeKeywords: parseList(row.include_keywords),
  excludeKeywords: parseList(row.exclude_keywords),
  workMode: row.work_mode,
  schedule: row.schedule,
  requireScheduleMatch: Boolean(row.require_schedule_match),
  workDaysPerWeek: row.work_days_per_week,
  workHoursPerWeek: row.work_hours_per_week,
  minimumSalary: row.minimum_salary,
  minimumSalaryCurrency: row.minimum_salary_currency ?? 'ARS',
  requireSalaryMatch: Boolean(row.require_salary_match),
  convertSalaryCurrencies: Boolean(row.convert_salary_currencies),
  active: Boolean(row.active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const candidateFromRow = (row: CandidateRow | undefined): CandidateProfile => ({
  fullName: row?.full_name ?? '',
  email: row?.email ?? '',
  phone: row?.phone ?? '',
  location: row?.location ?? '',
  availability: row?.availability ?? '',
  mobility: row?.mobility ?? '',
  summary: row?.summary ?? '',
  additionalFacts: row?.additional_facts ?? '',
  updatedAt: row?.updated_at ?? null,
})

const resumeFromRow = (row: ResumeRow): ResumeRecord => ({
  id: row.id,
  name: row.name,
  originalName: row.original_name,
  pageCount: row.page_count,
  extractedText: row.extracted_text,
  createdAt: row.created_at,
})

const opportunityFromRow = (row: OpportunityRow): Opportunity => ({
  id: row.id,
  profileId: row.profile_id,
  title: row.title,
  company: row.company,
  location: row.location,
  source: row.source,
  url: row.url,
  description: row.description,
  salaryText: row.salary_text,
  matchScore: row.match_score,
  matchReasons: parseList(row.match_reasons),
  missingRequirements: parseList(row.missing_requirements),
  status: row.status,
  appliedDate: row.applied_date ?? null,
  followUpDate: row.follow_up_date ?? null,
  trackingNotes: row.tracking_notes ?? '',
  discoveredAt: row.discovered_at,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const sourceFromRow = (row: SourceRow): UserSource => {
  const currentPolicy = findVerifiedSourcePolicy(row.kind, row.url)
  const storedPolicy = findVerifiedSourcePolicyById(row.verified_policy_id)
  const jsonConfig = row.kind === 'json' ? parseJsonSourceConfig(row.config_json) : null
  const configMatchesPolicy = !currentPolicy || verifiedSourcePolicyMatchesJsonConfig(currentPolicy, jsonConfig)
  const verifiedPolicy = currentPolicy && storedPolicy?.id === currentPolicy.id && configMatchesPolicy ? currentPolicy : null
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    jsonConfig,
    csvConfig: row.kind === 'csv' ? parseCsvSourceConfig(row.config_json) : null,
    profileId: row.profile_id,
    enabled: Boolean(row.enabled),
    automationApproved: Boolean(row.automation_approved && verifiedPolicy),
    customAutomationApproved: Boolean(row.custom_automation_approved && !verifiedPolicy),
    automationPolicyId: verifiedPolicy?.id ?? null,
    automationPolicyReviewedOn: verifiedPolicy?.reviewedOn ?? null,
    automationEvidenceUrl: row.automation_evidence_url ?? '',
    lastCheckedAt: row.last_checked_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

function parseJsonSourceConfig(value: string) {
  try {
    return validateJsonSourceConfig(JSON.parse(value))
  } catch {
    return null
  }
}

function parseCsvSourceConfig(value: string) {
  try {
    return validateCsvSourceConfig(JSON.parse(value))
  } catch {
    return null
  }
}


const draftFromRow = (row: DraftRow): ApplicationDraft => ({
  id: row.id,
  opportunityId: row.opportunity_id,
  resumeId: row.resume_id,
  message: row.message,
  resumeCopyText: row.resume_copy_text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class RadarDatabase {
  private db!: Database.Database
  private readonly userDataPath: string
  private readonly databasePath: string
  private readonly resumesPath: string

  constructor(userDataPath: string) {
    this.userDataPath = path.resolve(userDataPath)
    this.databasePath = path.join(this.userDataPath, 'radar-laboral.sqlite')
    fs.mkdirSync(this.userDataPath, { recursive: true })
    this.resumesPath = path.join(this.userDataPath, 'resumes')
    fs.mkdirSync(this.resumesPath, { recursive: true })
    this.openDatabase()
  }

  private openDatabase() {
    this.db = new Database(this.databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        search_description TEXT NOT NULL DEFAULT '',
        roles TEXT NOT NULL DEFAULT '[]',
        locations TEXT NOT NULL DEFAULT '[]',
        radius_km INTEGER NOT NULL DEFAULT 25,
        include_keywords TEXT NOT NULL DEFAULT '[]',
        exclude_keywords TEXT NOT NULL DEFAULT '[]',
        work_mode TEXT NOT NULL DEFAULT 'indistinto',
        schedule TEXT NOT NULL DEFAULT '',
        require_schedule_match INTEGER NOT NULL DEFAULT 0,
        work_days_per_week REAL,
        work_hours_per_week REAL,
        minimum_salary REAL,
        minimum_salary_currency TEXT NOT NULL DEFAULT 'ARS',
        require_salary_match INTEGER NOT NULL DEFAULT 0,
        convert_salary_currencies INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resumes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        extracted_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        profile_id TEXT REFERENCES search_profiles(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        salary_text TEXT NOT NULL DEFAULT '',
        match_score INTEGER,
        match_reasons TEXT NOT NULL DEFAULT '[]',
        missing_requirements TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'nueva',
        applied_date TEXT,
        follow_up_date TEXT,
        follow_up_notified_for_date TEXT,
        tracking_notes TEXT NOT NULL DEFAULT '',
        discovered_at TEXT NOT NULL,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candidate_profile (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        availability TEXT NOT NULL DEFAULT '',
        mobility TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        additional_facts TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind TEXT NOT NULL,
        profile_id TEXT REFERENCES search_profiles(id) ON DELETE SET NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        automation_approved INTEGER NOT NULL DEFAULT 0,
        custom_automation_approved INTEGER NOT NULL DEFAULT 0,
        verified_policy_id TEXT,
        automation_evidence_url TEXT NOT NULL DEFAULT '',
        config_json TEXT NOT NULL DEFAULT '{}',
        last_checked_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_drafts (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
        message TEXT NOT NULL DEFAULT '',
        resume_copy_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS opportunities_status_created
        ON opportunities(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS opportunities_profile
        ON opportunities(profile_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS resumes_created
      ON resumes(created_at DESC);
    `)
    const opportunityColumns = this.db.prepare('PRAGMA table_info(opportunities)').all() as Array<{ name: string }>
    if (!opportunityColumns.some((column) => column.name === 'applied_date')) {
      this.db.exec('ALTER TABLE opportunities ADD COLUMN applied_date TEXT')
    }
    if (!opportunityColumns.some((column) => column.name === 'follow_up_date')) {
      this.db.exec('ALTER TABLE opportunities ADD COLUMN follow_up_date TEXT')
    }
    if (!opportunityColumns.some((column) => column.name === 'follow_up_notified_for_date')) {
      this.db.exec('ALTER TABLE opportunities ADD COLUMN follow_up_notified_for_date TEXT')
    }
    if (!opportunityColumns.some((column) => column.name === 'tracking_notes')) {
      this.db.exec("ALTER TABLE opportunities ADD COLUMN tracking_notes TEXT NOT NULL DEFAULT ''")
    }
    const profileColumns = this.db.prepare('PRAGMA table_info(search_profiles)').all() as Array<{ name: string }>
    if (!profileColumns.some((column) => column.name === 'search_description')) {
      this.db.exec("ALTER TABLE search_profiles ADD COLUMN search_description TEXT NOT NULL DEFAULT ''")
    }
    if (!profileColumns.some((column) => column.name === 'minimum_salary_currency')) {
      this.db.exec("ALTER TABLE search_profiles ADD COLUMN minimum_salary_currency TEXT NOT NULL DEFAULT 'ARS'")
    }
    if (!profileColumns.some((column) => column.name === 'convert_salary_currencies')) {
      this.db.exec('ALTER TABLE search_profiles ADD COLUMN convert_salary_currencies INTEGER NOT NULL DEFAULT 0')
    }
    if (!profileColumns.some((column) => column.name === 'work_days_per_week')) {
      this.db.exec('ALTER TABLE search_profiles ADD COLUMN work_days_per_week REAL')
    }
    if (!profileColumns.some((column) => column.name === 'work_hours_per_week')) {
      this.db.exec('ALTER TABLE search_profiles ADD COLUMN work_hours_per_week REAL')
    }
    if (!profileColumns.some((column) => column.name === 'require_schedule_match')) {
      this.db.exec('ALTER TABLE search_profiles ADD COLUMN require_schedule_match INTEGER NOT NULL DEFAULT 0')
    }
    if (!profileColumns.some((column) => column.name === 'require_salary_match')) {
      this.db.exec('ALTER TABLE search_profiles ADD COLUMN require_salary_match INTEGER NOT NULL DEFAULT 0')
    }
    const sourceColumns = this.db.prepare('PRAGMA table_info(user_sources)').all() as Array<{ name: string }>
    if (!sourceColumns.some((column) => column.name === 'automation_approved')) {
      this.db.exec('ALTER TABLE user_sources ADD COLUMN automation_approved INTEGER NOT NULL DEFAULT 0')
    }
    if (!sourceColumns.some((column) => column.name === 'custom_automation_approved')) {
      this.db.exec('ALTER TABLE user_sources ADD COLUMN custom_automation_approved INTEGER NOT NULL DEFAULT 0')
    }
    if (!sourceColumns.some((column) => column.name === 'automation_evidence_url')) {
      this.db.exec("ALTER TABLE user_sources ADD COLUMN automation_evidence_url TEXT NOT NULL DEFAULT ''")
    }
    if (!sourceColumns.some((column) => column.name === 'verified_policy_id')) {
      this.db.exec('ALTER TABLE user_sources ADD COLUMN verified_policy_id TEXT')
    }
    if (!sourceColumns.some((column) => column.name === 'config_json')) {
      this.db.exec("ALTER TABLE user_sources ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'")
    }
    if (!sourceColumns.some((column) => column.name === 'last_attempt_at')) {
      this.db.exec('ALTER TABLE user_sources ADD COLUMN last_attempt_at TEXT')
    }
    if (!sourceColumns.some((column) => column.name === 'last_error')) {
      this.db.exec('ALTER TABLE user_sources ADD COLUMN last_error TEXT')
    }
    this.synchronizeSourcePolicies()
    const draftColumns = this.db.prepare('PRAGMA table_info(application_drafts)').all() as Array<{ name: string }>
    if (!draftColumns.some((column) => column.name === 'resume_copy_text')) {
      this.db.exec("ALTER TABLE application_drafts ADD COLUMN resume_copy_text TEXT NOT NULL DEFAULT ''")
      if (draftColumns.some((column) => column.name === 'tailored_resume_html')) {
        this.db.exec('UPDATE application_drafts SET resume_copy_text = tailored_resume_html')
      }
    }
  }

  private synchronizeSourcePolicies() {
    const sources = this.db.prepare('SELECT id, kind, url, enabled, custom_automation_approved, config_json FROM user_sources').all() as Array<{
      id: string
      kind: SourceKind
      url: string
      enabled: number
      custom_automation_approved: number
      config_json: string
    }>
    const setPolicy = this.db.prepare(`
      UPDATE user_sources
      SET verified_policy_id = ?, automation_approved = ?, custom_automation_approved = 0, automation_evidence_url = ?, enabled = ?
      WHERE id = ?
    `)
    const keepCustomApproval = this.db.prepare(`
      UPDATE user_sources
      SET verified_policy_id = NULL, automation_approved = 0, enabled = CASE WHEN custom_automation_approved = 1 THEN enabled ELSE 0 END
      WHERE id = ?
    `)
    const pauseInvalidPolicyConfig = this.db.prepare(`
      UPDATE user_sources
      SET verified_policy_id = NULL, automation_approved = 0, custom_automation_approved = 0, enabled = 0
      WHERE id = ?
    `)
    const transaction = this.db.transaction(() => {
      for (const source of sources) {
        if (source.kind === 'website') continue
        const policy = findVerifiedSourcePolicy(source.kind, source.url)
        const jsonConfig = source.kind === 'json' ? parseJsonSourceConfig(source.config_json) : null
        if (!policy) {
          keepCustomApproval.run(source.id)
          continue
        }
        if (!verifiedSourcePolicyMatchesJsonConfig(policy, jsonConfig)) {
          pauseInvalidPolicyConfig.run(source.id)
          continue
        }
        setPolicy.run(policy.id, 1, policy.evidenceUrl, source.enabled, source.id)
      }
    })
    transaction()
  }

  listProfiles(): SearchProfile[] {
    const rows = this.db.prepare('SELECT * FROM search_profiles ORDER BY updated_at DESC').all() as ProfileRow[]
    return rows.map(profileFromRow)
  }

  candidateProfile(): CandidateProfile {
    const row = this.db.prepare("SELECT * FROM candidate_profile WHERE id = 'primary'").get() as CandidateRow | undefined
    return candidateFromRow(row)
  }

  saveCandidateProfile(input: CandidateProfileInput): CandidateProfile {
    this.db.prepare(`
      INSERT INTO candidate_profile (
        id, full_name, email, phone, location, availability, mobility, summary, additional_facts, updated_at
      ) VALUES ('primary', @fullName, @email, @phone, @location, @availability, @mobility, @summary, @additionalFacts, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        location = excluded.location,
        availability = excluded.availability,
        mobility = excluded.mobility,
        summary = excluded.summary,
        additional_facts = excluded.additional_facts,
        updated_at = excluded.updated_at
    `).run({ ...input, updatedAt: now() })
    return this.candidateProfile()
  }

  saveProfile(input: SearchProfileInput, id: string = randomUUID()): SearchProfile {
    const timestamp = now()
    const existing = this.db.prepare('SELECT created_at FROM search_profiles WHERE id = ?').get(id) as
      | { created_at: string }
      | undefined
    this.db.prepare(`
      INSERT INTO search_profiles (
        id, name, search_description, roles, locations, radius_km, include_keywords, exclude_keywords,
        work_mode, schedule, require_schedule_match, work_days_per_week, work_hours_per_week, minimum_salary, minimum_salary_currency,
        require_salary_match, convert_salary_currencies, active, created_at, updated_at
      ) VALUES (
        @id, @name, @searchDescription, @roles, @locations, @radiusKm, @includeKeywords, @excludeKeywords,
        @workMode, @schedule, @requireScheduleMatch, @workDaysPerWeek, @workHoursPerWeek, @minimumSalary, @minimumSalaryCurrency,
        @requireSalaryMatch, @convertSalaryCurrencies, @active, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        search_description = excluded.search_description,
        roles = excluded.roles,
        locations = excluded.locations,
        radius_km = excluded.radius_km,
        include_keywords = excluded.include_keywords,
        exclude_keywords = excluded.exclude_keywords,
        work_mode = excluded.work_mode,
        schedule = excluded.schedule,
        require_schedule_match = excluded.require_schedule_match,
        work_days_per_week = excluded.work_days_per_week,
        work_hours_per_week = excluded.work_hours_per_week,
        minimum_salary = excluded.minimum_salary,
        minimum_salary_currency = excluded.minimum_salary_currency,
        require_salary_match = excluded.require_salary_match,
        convert_salary_currencies = excluded.convert_salary_currencies,
        active = excluded.active,
        updated_at = excluded.updated_at
    `).run({
      id,
      name: input.name.trim(),
      searchDescription: input.searchDescription.trim(),
      roles: JSON.stringify(input.roles),
      locations: JSON.stringify(input.locations),
      radiusKm: input.radiusKm,
      includeKeywords: JSON.stringify(input.includeKeywords),
      excludeKeywords: JSON.stringify(input.excludeKeywords),
      workMode: input.workMode,
      schedule: input.schedule,
      requireScheduleMatch: Number(Boolean(input.requireScheduleMatch)),
      workDaysPerWeek: validWorkDaysPerWeek(input.workDaysPerWeek),
      workHoursPerWeek: validWorkHoursPerWeek(input.workHoursPerWeek),
      minimumSalary: input.minimumSalary,
      minimumSalaryCurrency: input.minimumSalaryCurrency ?? 'ARS',
      requireSalaryMatch: Number(Boolean(input.requireSalaryMatch)),
      convertSalaryCurrencies: Number(Boolean(input.convertSalaryCurrencies)),
      active: Number(input.active),
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp,
    })
    return profileFromRow(this.db.prepare('SELECT * FROM search_profiles WHERE id = ?').get(id) as ProfileRow)
  }

  removeProfile(id: string) {
    this.db.prepare('DELETE FROM search_profiles WHERE id = ?').run(id)
  }

  listOpportunities(): Opportunity[] {
    const rows = this.db.prepare('SELECT * FROM opportunities ORDER BY created_at DESC').all() as OpportunityRow[]
    return rows.map(opportunityFromRow)
  }

  getOpportunity(id: string): Opportunity | null {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as OpportunityRow | undefined
    return row ? opportunityFromRow(row) : null
  }

  addOpportunity(input: OpportunityInput): Opportunity {
    const existing = this.db.prepare('SELECT id FROM opportunities WHERE url = ? COLLATE NOCASE').get(input.url)
    if (existing) throw new Error('Esta vacante ya está en tu seguimiento.')
    return this.insertOpportunity(input)!
  }

  addOpportunityIfNew(input: OpportunityInput): Opportunity | null {
    const existing = this.db.prepare('SELECT id FROM opportunities WHERE url = ? COLLATE NOCASE').get(input.url)
    if (existing) return null
    return this.insertOpportunity(input)
  }

  addOpportunitiesIfNew(inputs: OpportunityInput[]): { added: number; duplicates: number } {
    if (inputs.length > 1000) throw new Error('No se pueden importar más de 1000 avisos a la vez.')
    return this.db.transaction(() => {
      let added = 0
      let duplicates = 0
      for (const input of inputs) {
        if (this.addOpportunityIfNew(input)) added += 1
        else duplicates += 1
      }
      return { added, duplicates }
    })()
  }

  private insertOpportunity(input: OpportunityInput): Opportunity | null {
    const id = randomUUID()
    const timestamp = now()
    const result = this.db.prepare(`
      INSERT INTO opportunities (
        id, profile_id, title, company, location, source, url, description,
        salary_text, match_score, match_reasons, missing_requirements, published_at,
        discovered_at, created_at, updated_at
      ) VALUES (
        @id, @profileId, @title, @company, @location, @source, @url, @description,
        @salaryText, @matchScore, @matchReasons, @missingRequirements, @publishedAt,
        @timestamp, @timestamp, @timestamp
      )
    `).run({
      id,
      profileId: input.profileId,
      title: input.title.trim(),
      company: input.company.trim(),
      location: input.location.trim(),
      source: input.source.trim(),
      url: input.url.trim(),
      description: input.description.trim(),
      salaryText: input.salaryText.trim(),
      matchScore: input.matchScore ?? null,
      matchReasons: JSON.stringify(input.matchReasons ?? []),
      missingRequirements: JSON.stringify(input.missingRequirements ?? []),
      publishedAt: input.publishedAt ?? null,
      timestamp,
    })
    if (result.changes === 0) return null
    return opportunityFromRow(this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as OpportunityRow)
  }

  updateOpportunityStatus(id: string, status: OpportunityStatus): Opportunity | null {
    const timestamp = now()
    this.db.prepare(`
      UPDATE opportunities
      SET status = ?,
        applied_date = CASE WHEN ? = 'postulada' THEN COALESCE(applied_date, ?) ELSE applied_date END,
        updated_at = ?
      WHERE id = ?
    `).run(status, status, localDateString(), timestamp, id)
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as OpportunityRow | undefined
    return row ? opportunityFromRow(row) : null
  }

  updateOpportunityTracking(id: string, rawInput: OpportunityTrackingInput): Opportunity | null {
    const input = validateOpportunityTracking(rawInput)
    this.db.prepare(`
      UPDATE opportunities
      SET applied_date = ?, follow_up_date = ?,
        follow_up_notified_for_date = CASE WHEN follow_up_date IS ? THEN follow_up_notified_for_date ELSE NULL END,
        tracking_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(input.appliedDate, input.followUpDate, input.followUpDate, input.trackingNotes, now(), id)
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as OpportunityRow | undefined
    return row ? opportunityFromRow(row) : null
  }

  listDueFollowUps(today: string): DueFollowUpReminder[] {
    return this.db.prepare(`
      SELECT id, follow_up_date AS followUpDate
      FROM opportunities
      WHERE status = 'postulada'
        AND follow_up_date IS NOT NULL
        AND follow_up_date <= ?
        AND (follow_up_notified_for_date IS NULL OR follow_up_notified_for_date <> follow_up_date)
      ORDER BY follow_up_date ASC, created_at ASC
    `).all(today) as DueFollowUpReminder[]
  }

  markFollowUpRemindersNotified(reminders: readonly DueFollowUpReminder[], today: string): number {
    if (reminders.length > 10_000) throw new Error('Hay demasiados recordatorios para procesar a la vez.')
    const markOne = this.db.prepare(`
      UPDATE opportunities
      SET follow_up_notified_for_date = ?
      WHERE id = ? AND status = 'postulada' AND follow_up_date = ? AND follow_up_date <= ?
        AND (follow_up_notified_for_date IS NULL OR follow_up_notified_for_date <> follow_up_date)
    `)
    return this.db.transaction(() => {
      let marked = 0
      for (const reminder of reminders) {
        if (!reminder || typeof reminder.id !== 'string' || typeof reminder.followUpDate !== 'string') continue
        marked += markOne.run(reminder.followUpDate, reminder.id, reminder.followUpDate, today).changes
      }
      return marked
    })()
  }

  removeOpportunity(id: string) {
    const drafts = this.db.prepare('SELECT COUNT(*) AS count FROM application_drafts WHERE opportunity_id = ?').get(id) as { count: number }
    if (drafts.count > 0) throw new Error('Esta vacante tiene borradores asociados. Eliminá los borradores antes de borrar la vacante.')
    this.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id)
  }

  listSources(): UserSource[] {
    const rows = this.db.prepare('SELECT * FROM user_sources ORDER BY created_at DESC').all() as SourceRow[]
    return rows.map(sourceFromRow)
  }

  enabledSources(): UserSource[] {
    const rows = this.db.prepare(`
      SELECT * FROM user_sources
      WHERE enabled = 1 AND kind IN ('rss', 'json', 'csv')
        AND (
          (automation_approved = 1 AND verified_policy_id IS NOT NULL)
          OR custom_automation_approved = 1
        )
      ORDER BY created_at ASC
    `).all() as SourceRow[]
    return rows.map(sourceFromRow).filter((source) => (source.automationApproved || source.customAutomationApproved) && source.enabled)
  }

  addSource(input: UserSourceInput): UserSource {
    let sourceUrl: URL
    if (input.kind === 'rss' || input.kind === 'json' || input.kind === 'csv') {
      try {
        sourceUrl = new URL(input.url)
      } catch {
        throw new Error('La fuente automática requiere un enlace HTTPS válido.')
      }
      if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) {
        throw new Error('Las fuentes automáticas deben usar HTTPS y no incluir credenciales.')
      }
      if (urlCarriesSecret(sourceUrl)) {
        throw new Error('Las fuentes automáticas deben ser públicas y no incluir claves o credenciales en el enlace.')
      }
    } else {
      try {
        sourceUrl = new URL(input.url)
      } catch {
        throw new Error('Ingresá un enlace web válido.')
      }
      if (!['https:', 'http:'].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
        throw new Error('La fuente debe usar un enlace web público sin credenciales.')
      }
      if (urlCarriesSecret(sourceUrl)) {
        throw new Error('El enlace de la fuente no puede incluir claves o credenciales en los parámetros.')
      }
    }
    let evidenceUrl = ''
    if (input.automationEvidenceUrl) {
      try {
        const parsedEvidence = new URL(input.automationEvidenceUrl)
        if (parsedEvidence.protocol !== 'https:' || parsedEvidence.username || parsedEvidence.password) throw new Error()
        evidenceUrl = parsedEvidence.toString()
      } catch {
        throw new Error('La referencia opcional debe ser una página HTTPS sin credenciales.')
      }
    }
    const jsonConfig = input.kind === 'json' ? validateJsonSourceConfig(input.jsonConfig) : null
    const csvConfig = input.kind === 'csv' ? validateCsvSourceConfig(input.csvConfig) : null
    const policy = findVerifiedSourcePolicy(input.kind, sourceUrl.toString())
    if (policy && !verifiedSourcePolicyMatchesJsonConfig(policy, jsonConfig)) {
      throw new Error('El mapeo JSON de este endpoint debe conservar los filtros exactos definidos por la política de Radar.')
    }
    const isAutomatic = input.kind === 'rss' || input.kind === 'json' || input.kind === 'csv'
    const customAutomationApproved = isAutomatic && !policy && input.customAutomationApproved === true
    const enabled = !isAutomatic || policy || customAutomationApproved ? input.enabled : false
    const approvedEvidenceUrl = policy?.evidenceUrl ?? evidenceUrl
    if (input.kind !== 'json' && input.jsonConfig) {
      throw new Error('Solo una fuente JSON puede tener un mapeo de campos.')
    }
    if (input.kind !== 'csv' && input.csvConfig) {
      throw new Error('Solo una fuente CSV puede tener un mapeo de columnas.')
    }
    const existingSource = this.db.prepare('SELECT id FROM user_sources WHERE url = ? COLLATE NOCASE').get(sourceUrl.toString()) as { id: string } | undefined
    if (existingSource) throw new Error('Ya existe una fuente con ese enlace. Revisá la lista de fuentes antes de agregarla.')
    const id = randomUUID()
    try {
      this.db.prepare(`
        INSERT INTO user_sources (
          id, name, url, kind, profile_id, enabled, automation_approved, custom_automation_approved, verified_policy_id, automation_evidence_url, config_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name.trim(),
        sourceUrl.toString(),
        input.kind,
        input.profileId,
        Number(enabled),
        Number(Boolean(policy)),
        Number(customAutomationApproved),
        policy?.id ?? null,
        approvedEvidenceUrl,
        JSON.stringify(jsonConfig ?? csvConfig ?? {}),
        now(),
      )
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: user_sources\.url/iu.test(error.message)) {
        throw new Error('Ya existe una fuente con ese enlace. Revisá la lista de fuentes antes de agregarla.')
      }
      throw error
    }
    return sourceFromRow(this.db.prepare('SELECT * FROM user_sources WHERE id = ?').get(id) as SourceRow)
  }

  updateSourceEnabled(id: string, enabled: boolean): UserSource | null {
    if (enabled) {
      const source = this.db.prepare('SELECT kind, url, verified_policy_id, automation_approved, custom_automation_approved, config_json FROM user_sources WHERE id = ?').get(id) as
        | { kind: SourceKind; url: string; verified_policy_id: string | null; automation_approved: number; custom_automation_approved: number; config_json: string }
        | undefined
      const isAutomatic = source?.kind === 'rss' || source?.kind === 'json' || source?.kind === 'csv'
      const policy = source ? findVerifiedSourcePolicy(source.kind, source.url) : null
      const jsonConfig = source?.kind === 'json' ? parseJsonSourceConfig(source.config_json) : null
      const verifiedPolicyApproved = Boolean(source && policy && source.automation_approved && policy.id === source.verified_policy_id && verifiedSourcePolicyMatchesJsonConfig(policy, jsonConfig))
      const customPolicyApproved = Boolean(source && source.custom_automation_approved && !policy)
      if (isAutomatic && !verifiedPolicyApproved && !customPolicyApproved) {
        throw new Error('Para consultar esta fuente automática, confirmá que autorizás las consultas al endpoint público o elegí una fuente con política vigente de Radar.')
      }
    }
    this.db.prepare('UPDATE user_sources SET enabled = ? WHERE id = ?').run(Number(enabled), id)
    const row = this.db.prepare('SELECT * FROM user_sources WHERE id = ?').get(id) as SourceRow | undefined
    return row ? sourceFromRow(row) : null
  }

  updateCustomAutomationApproval(id: string, approved: boolean): UserSource | null {
    const source = this.db.prepare('SELECT kind, url, config_json FROM user_sources WHERE id = ?').get(id) as
      | { kind: SourceKind; url: string; config_json: string }
      | undefined
    if (!source) return null
    const isAutomatic = source.kind === 'rss' || source.kind === 'json' || source.kind === 'csv'
    if (!isAutomatic) {
      throw new Error('Solo se puede autorizar la consulta automática de fuentes RSS/Atom, JSON o CSV.')
    }
    if (findVerifiedSourcePolicy(source.kind, source.url)) {
      throw new Error('Esta fuente tiene una política verificada por Radar y su autorización se administra con esa política.')
    }
    if (approved && source.kind === 'json' && !parseJsonSourceConfig(source.config_json)) {
      throw new Error('El mapeo JSON de esta fuente no es válido; revisalo antes de autorizar consultas automáticas.')
    }
    if (approved && source.kind === 'csv' && !parseCsvSourceConfig(source.config_json)) {
      throw new Error('El mapeo CSV de esta fuente no es válido; revisalo antes de autorizar consultas automáticas.')
    }

    this.db.prepare(`
      UPDATE user_sources
      SET enabled = CASE WHEN ? = 0 OR custom_automation_approved = 0 THEN 0 ELSE enabled END,
          custom_automation_approved = ?
      WHERE id = ?
    `).run(Number(approved), Number(approved), id)
    const row = this.db.prepare('SELECT * FROM user_sources WHERE id = ?').get(id) as SourceRow | undefined
    return row ? sourceFromRow(row) : null
  }

  markSourceChecked(id: string, checkedAt: string) {
    this.db.prepare(`
      UPDATE user_sources
      SET last_checked_at = ?, last_attempt_at = ?, last_error = NULL
      WHERE id = ?
    `).run(checkedAt, checkedAt, id)
  }

  markSourceFailed(id: string, attemptedAt: string, error: string) {
    this.db.prepare(`
      UPDATE user_sources SET last_attempt_at = ?, last_error = ? WHERE id = ?
    `).run(attemptedAt, error.slice(0, 500), id)
  }

  removeSource(id: string) {
    this.db.prepare('DELETE FROM user_sources WHERE id = ?').run(id)
  }

  listDrafts(): ApplicationDraft[] {
    const rows = this.db.prepare('SELECT * FROM application_drafts ORDER BY updated_at DESC').all() as DraftRow[]
    return rows.map(draftFromRow)
  }

  saveDraft(input: ApplicationDraftInput): ApplicationDraft {
    const opportunityExists = this.db.prepare('SELECT 1 FROM opportunities WHERE id = ?').get(input.opportunityId)
    if (!opportunityExists) throw new Error('No se encontró la vacante del borrador.')
    if (input.resumeId) {
      const resumeExists = this.db.prepare('SELECT 1 FROM resumes WHERE id = ?').get(input.resumeId)
      if (!resumeExists) throw new Error('No se encontró el CV elegido para el borrador.')
    }
    const id = input.id ?? randomUUID()
    const timestamp = now()
    const existing = this.db.prepare('SELECT created_at FROM application_drafts WHERE id = ?').get(id) as
      | { created_at: string }
      | undefined
    this.db.prepare(`
      INSERT INTO application_drafts (
        id, opportunity_id, resume_id, message, resume_copy_text, created_at, updated_at
      ) VALUES (@id, @opportunityId, @resumeId, @message, @resumeHtml, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        opportunity_id = excluded.opportunity_id,
        resume_id = excluded.resume_id,
        message = excluded.message,
        resume_copy_text = excluded.resume_copy_text,
        updated_at = excluded.updated_at
    `).run({
      id,
      opportunityId: input.opportunityId,
      resumeId: input.resumeId,
      message: input.message,
      resumeHtml: input.resumeCopyText,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp,
    })
    return draftFromRow(this.db.prepare('SELECT * FROM application_drafts WHERE id = ?').get(id) as DraftRow)
  }

  removeDraft(id: string) {
    this.db.prepare('DELETE FROM application_drafts WHERE id = ?').run(id)
  }

  listResumes(): ResumeRecord[] {
    const rows = this.db.prepare('SELECT * FROM resumes ORDER BY created_at DESC').all() as ResumeRow[]
    return rows.map(resumeFromRow)
  }

  getResume(id: string): ResumeRecord | null {
    return this.resumeById(id)
  }

  addResume(input: ResumeInput): ResumeRecord {
    if (input.bytes.byteLength > 20 * 1024 * 1024) throw new Error('El PDF supera el límite de 20 MB.')
    const bytes = Buffer.from(input.bytes)
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('El archivo no parece ser un PDF válido.')
    const id = randomUUID()
    const storedPath = path.join(this.resumesPath, `${id}.pdf`)
    fs.writeFileSync(storedPath, bytes, { flag: 'wx' })
    try {
      this.db.prepare(`
        INSERT INTO resumes (id, name, original_name, stored_path, page_count, extracted_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name.trim(), path.basename(input.originalName), storedPath, input.pageCount, input.extractedText, now())
    } catch (error) {
      fs.rmSync(storedPath, { force: true })
      throw error
    }
    return this.resumeById(id)!
  }

  removeResume(id: string) {
    const row = this.db.prepare('SELECT stored_path FROM resumes WHERE id = ?').get(id) as
      | { stored_path: string }
      | undefined
    if (!row) return
    this.db.prepare('DELETE FROM resumes WHERE id = ?').run(id)
    try {
      const resolved = path.resolve(row.stored_path)
      if (path.dirname(resolved) === path.resolve(this.resumesPath)) fs.rmSync(resolved, { force: true })
    } catch {
      // The database row is already gone; a leftover PDF is harmless and gets
      // skipped by future backup validation.
    }
  }

  private resumeById(id: string): ResumeRecord | null {
    const row = this.db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow | undefined
    return row ? resumeFromRow(row) : null
  }

  summary(): DashboardSummary {
    const profiles = this.db.prepare('SELECT COUNT(*) AS count FROM search_profiles WHERE active = 1').get() as { count: number }
    const newJobs = this.db.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE status = 'nueva'").get() as { count: number }
    const sources = this.db.prepare('SELECT COUNT(*) AS count FROM user_sources WHERE enabled = 1').get() as { count: number }
    const applied = this.db.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE status = 'postulada'").get() as { count: number }
    const resumes = this.db.prepare('SELECT COUNT(*) AS count FROM resumes').get() as { count: number }
    return {
      activeProfiles: profiles.count,
      activeSources: sources.count,
      newOpportunities: newJobs.count,
      applicationsSent: applied.count,
      resumes: resumes.count,
    }
  }

  settings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
    const values = new Map(rows.map(({ key, value }) => [key, value]))
    return {
      searchIntervalHours: [4, 8, 12, 24].includes(Number(values.get('searchIntervalHours'))) ? Number(values.get('searchIntervalHours')) : 4,
      backgroundSearchEnabled: values.has('backgroundSearchEnabled')
        ? values.get('backgroundSearchEnabled') === 'true'
        : values.get('startAtLogin') === 'true',
      aiEnabled: values.get('aiEnabled') === 'true',
      aiBaseUrl: values.get('aiBaseUrl') ?? '',
      aiModel: values.get('aiModel') ?? '',
      aiApiKeyConfigured: Boolean(values.get('aiApiKeyEncrypted')),
      salaryExchangeRates: this.salaryExchangeRates(),
    }
  }

  salaryExchangeRates(): SalaryExchangeRateSnapshot | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('salaryExchangeRates') as { value: string } | undefined
    if (!row) return null
    try {
      const snapshot: unknown = JSON.parse(row.value)
      return isSalaryExchangeRateSnapshot(snapshot) ? snapshot : null
    } catch {
      return null
    }
  }

  saveSalaryExchangeRates(snapshot: SalaryExchangeRateSnapshot) {
    if (!isSalaryExchangeRateSnapshot(snapshot)) throw new Error('La cotización del BCRA no tiene un formato válido.')
    this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('salaryExchangeRates', JSON.stringify(snapshot))
  }

  saveSettings(settings: AppSettingsInput, encryptedAiApiKey?: string | null): AppSettings {
    const save = this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    const remove = this.db.prepare('DELETE FROM app_settings WHERE key = ?')
    const transaction = this.db.transaction(() => {
      save.run('searchIntervalHours', String(settings.searchIntervalHours))
      save.run('backgroundSearchEnabled', String(settings.backgroundSearchEnabled))
      remove.run('startAtLogin')
      save.run('aiEnabled', String(settings.aiEnabled))
      save.run('aiBaseUrl', settings.aiBaseUrl.trim())
      save.run('aiModel', settings.aiModel.trim())
      if (encryptedAiApiKey !== undefined) {
        if (encryptedAiApiKey === null) remove.run('aiApiKeyEncrypted')
        else save.run('aiApiKeyEncrypted', encryptedAiApiKey)
      }
    })
    transaction()
    return this.settings()
  }

  saveAiApiKeyEncrypted(value: string | null) {
    if (value === null) {
      this.db.prepare('DELETE FROM app_settings WHERE key = ?').run('aiApiKeyEncrypted')
      return
    }
    this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('aiApiKeyEncrypted', value)
  }

  aiApiKeyEncrypted(): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('aiApiKeyEncrypted') as { value: string } | undefined
    return row?.value ?? null
  }

  async createBackup(parentDirectory: string, appVersion: string) {
    const parent = path.resolve(parentDirectory)
    const parentStats = fs.lstatSync(parent)
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error('Elegí una carpeta de destino para la copia.')
    let parentReal: string
    try {
      parentReal = fs.realpathSync(parent)
    } catch {
      throw new Error('Elegí una carpeta de destino para la copia.')
    }
    let resumesReal: string
    try {
      resumesReal = fs.realpathSync(this.resumesPath)
    } catch {
      resumesReal = path.resolve(this.resumesPath)
    }
    if (this.isInside(resumesReal, parentReal)) {
      throw new Error('Guardá la copia fuera de la carpeta donde están los CV.')
    }

    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const backupDirectory = path.join(parent, `Radar-Laboral-backup-${timestamp}-${randomUUID().slice(0, 8)}`)
    fs.mkdirSync(backupDirectory)
    try {
      const backupDatabasePath = path.join(backupDirectory, 'radar-laboral.sqlite')
      const backupResumesPath = path.join(backupDirectory, 'resumes')
      await this.db.backup(backupDatabasePath)
      fs.mkdirSync(backupResumesPath)

      // Copy the files referenced by the completed SQLite snapshot. A CV can be
      // added or removed while SQLite's asynchronous backup is running, so
      // copying the whole live directory could leave an inconsistent backup.
      const snapshot = new Database(backupDatabasePath, { readonly: true, fileMustExist: true })
      try {
        const rows = snapshot.prepare('SELECT id FROM resumes').all() as Array<{ id: string }>
        for (const { id } of rows) {
          const filename = `${id}.pdf`
          const sourcePath = path.join(this.resumesPath, filename)
          const sourceStats = fs.lstatSync(sourcePath)
          if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || sourceStats.size > 20 * 1024 * 1024) {
            throw new Error('No se pudo incluir un CV de forma segura en la copia.')
          }
          fs.copyFileSync(sourcePath, path.join(backupResumesPath, filename), fs.constants.COPYFILE_EXCL)
        }
      } finally {
        snapshot.close()
      }
      const manifest = {
        format: 'radar-laboral-backup',
        formatVersion: 1,
        createdAt: now(),
        appVersion,
      }
      fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
      this.validateBackup(
        backupDirectory,
        path.join(backupDirectory, 'manifest.json'),
        backupDatabasePath,
        backupResumesPath,
      )
      return backupDirectory
    } catch (error) {
      fs.rmSync(backupDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async restoreBackup(sourceDirectory: string) {
    const backupDirectory = path.resolve(sourceDirectory)
    const manifestPath = path.join(backupDirectory, 'manifest.json')
    const backupDatabasePath = path.join(backupDirectory, 'radar-laboral.sqlite')
    const backupResumesPath = path.join(backupDirectory, 'resumes')
    this.validateBackup(backupDirectory, manifestPath, backupDatabasePath, backupResumesPath)

    const stagingDirectory = path.join(path.dirname(this.userDataPath), `.radar-laboral-restore-${randomUUID()}`)
    const rollbackDirectory = path.join(path.dirname(this.userDataPath), `.radar-laboral-rollback-${randomUUID()}`)
    fs.mkdirSync(stagingDirectory)
    let stagedDatabase: RadarDatabase | null = null
    try {
      fs.copyFileSync(backupDatabasePath, path.join(stagingDirectory, 'radar-laboral.sqlite'))
      fs.cpSync(backupResumesPath, path.join(stagingDirectory, 'resumes'), { recursive: true, errorOnExist: true, force: false })
      stagedDatabase = new RadarDatabase(stagingDirectory)
      stagedDatabase.rebaseResumePaths(this.userDataPath)
      stagedDatabase.close()
      stagedDatabase = null
    } catch (error) {
      stagedDatabase?.close()
      fs.rmSync(stagingDirectory, { recursive: true, force: true })
      throw error
    }

    fs.mkdirSync(rollbackDirectory)
    const rollbackFiles = [
      [this.databasePath, path.join(rollbackDirectory, 'radar-laboral.sqlite')],
      [`${this.databasePath}-wal`, path.join(rollbackDirectory, 'radar-laboral.sqlite-wal')],
      [`${this.databasePath}-shm`, path.join(rollbackDirectory, 'radar-laboral.sqlite-shm')],
      [this.resumesPath, path.join(rollbackDirectory, 'resumes')],
    ] as const
    const movedOriginalPaths = new Set<string>()
    const installedPaths = new Set<string>()
    let restoredOriginal = false
    let installedNewData = false
    this.db.close()
    try {
      for (const [currentPath, savedPath] of rollbackFiles) {
        if (fs.existsSync(currentPath)) {
          fs.renameSync(currentPath, savedPath)
          movedOriginalPaths.add(currentPath)
        }
      }
      fs.renameSync(path.join(stagingDirectory, 'radar-laboral.sqlite'), this.databasePath)
      installedPaths.add(this.databasePath)
      fs.renameSync(path.join(stagingDirectory, 'resumes'), this.resumesPath)
      installedPaths.add(this.resumesPath)
      this.openDatabase()
      installedNewData = true
      return { profiles: this.listProfiles().length, resumes: this.listResumes().length }
    } catch (error) {
      if (this.db?.open) this.db.close()
      for (const currentPath of installedPaths) {
        if (fs.existsSync(currentPath)) fs.rmSync(currentPath, { recursive: true, force: true })
      }
      try {
        for (const [currentPath, savedPath] of rollbackFiles) {
          if (movedOriginalPaths.has(currentPath) && fs.existsSync(savedPath)) fs.renameSync(savedPath, currentPath)
        }
        this.openDatabase()
        restoredOriginal = true
      } catch (rollbackError) {
        throw new Error(`Falló la restauración y no se pudo reponer automáticamente la base anterior. Conservé los archivos de recuperación en ${rollbackDirectory}. Detalle: ${String(rollbackError)}`)
      }
      throw error
    } finally {
      fs.rmSync(stagingDirectory, { recursive: true, force: true })
      if (installedNewData || restoredOriginal) fs.rmSync(rollbackDirectory, { recursive: true, force: true })
    }
  }

  private validateBackup(backupDirectory: string, manifestPath: string, backupDatabasePath: string, backupResumesPath: string) {
    const backupStats = fs.lstatSync(backupDirectory)
    if (!backupStats.isDirectory() || backupStats.isSymbolicLink() || this.isInside(this.resumesPath, backupDirectory)) {
      throw new Error('Elegí una carpeta de copia válida, fuera de la carpeta de CV.')
    }
    const manifestStats = fs.lstatSync(manifestPath)
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw new Error('El manifiesto de la copia no es válido.')
    let manifest: { format?: string; formatVersion?: number }
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { format?: string; formatVersion?: number }
    } catch {
      throw new Error('El manifiesto de la copia está dañado y no se puede leer.')
    }
    if (manifest.format !== 'radar-laboral-backup' || manifest.formatVersion !== 1) {
      throw new Error('La carpeta no es una copia de seguridad compatible de Radar Laboral.')
    }

    const databaseStats = fs.lstatSync(backupDatabasePath)
    const resumesStats = fs.lstatSync(backupResumesPath)
    if (!databaseStats.isFile() || databaseStats.isSymbolicLink() || !resumesStats.isDirectory() || resumesStats.isSymbolicLink()) {
      throw new Error('La copia no contiene una base y una carpeta de CV válidas.')
    }

    const backupDb = new Database(backupDatabasePath, { readonly: true, fileMustExist: true })
    try {
      const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('La base SQLite de la copia no superó la comprobación de integridad.')
      }
      const tables = new Set((backupDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
      const requiredTables = ['search_profiles', 'resumes', 'opportunities', 'app_settings', 'candidate_profile', 'user_sources', 'application_drafts']
      if (requiredTables.some((table) => !tables.has(table))) throw new Error('La base de la copia no contiene las tablas de Radar Laboral.')

      const resumeRows = backupDb.prepare('SELECT id FROM resumes').all() as Array<{ id: string }>
      const expectedFiles = new Set<string>()
      for (const { id } of resumeRows) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          throw new Error('La copia contiene un identificador de CV no válido.')
        }
        const filename = `${id}.pdf`
        expectedFiles.add(filename)
        const resumePath = path.join(backupResumesPath, filename)
        if (!fs.existsSync(resumePath)) throw new Error('La copia no contiene todos los archivos PDF registrados.')
        const resumeStats = fs.lstatSync(resumePath)
        if (!resumeStats.isFile() || resumeStats.isSymbolicLink() || resumeStats.size > 20 * 1024 * 1024) {
          throw new Error('La copia contiene un archivo de CV no válido.')
        }
        const fileDescriptor = fs.openSync(resumePath, 'r')
        try {
          const header = Buffer.alloc(5)
          if (fs.readSync(fileDescriptor, header, 0, header.length, 0) !== header.length || header.toString('ascii') !== '%PDF-') {
            throw new Error('Uno de los CV de la copia no parece ser un PDF válido.')
          }
        } finally {
          fs.closeSync(fileDescriptor)
        }
      }
      const actualFiles = fs.readdirSync(backupResumesPath)
      if (actualFiles.length !== expectedFiles.size || actualFiles.some((filename) => !expectedFiles.has(filename))) {
        throw new Error('Los archivos de CV de la copia no coinciden con los registros de la base.')
      }
    } finally {
      backupDb.close()
    }
  }

  private rebaseResumePaths(userDataPath: string) {
    const targetResumesPath = path.join(userDataPath, 'resumes')
    const update = this.db.prepare('UPDATE resumes SET stored_path = ? WHERE id = ?')
    const rows = this.db.prepare('SELECT id FROM resumes').all() as Array<{ id: string }>
    const transaction = this.db.transaction(() => {
      for (const { id } of rows) update.run(path.join(targetResumesPath, `${id}.pdf`), id)
    })
    transaction()
  }

  private isInside(parent: string, candidate: string) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate))
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }

  close() {
    if (this.db.open) this.db.close()
  }
}
