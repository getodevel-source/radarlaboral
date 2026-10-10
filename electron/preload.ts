import { contextBridge, ipcRenderer } from 'electron'
import type { RadarApi } from '../src/shared/types'

const api: RadarApi = {
  geography: {
    searchLocalities: (query) => ipcRenderer.invoke('geography:search-localities', query),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: (input) => ipcRenderer.invoke('profiles:save', { profile: input }),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
  },
  candidate: {
    get: () => ipcRenderer.invoke('candidate:get'),
    save: (profile) => ipcRenderer.invoke('candidate:save', profile),
  },
  opportunities: {
    list: () => ipcRenderer.invoke('opportunities:list'),
    add: (input) => ipcRenderer.invoke('opportunities:add', input),
    importCsv: (input) => ipcRenderer.invoke('opportunities:import-csv', input),
    previewJsonImport: (input) => ipcRenderer.invoke('opportunities:preview-json', input),
    importJson: (input) => ipcRenderer.invoke('opportunities:import-json', input),
    updateStatus: (id, status) => ipcRenderer.invoke('opportunities:update-status', { id, status }),
    updateTracking: (id, tracking) => ipcRenderer.invoke('opportunities:update-tracking', { id, tracking }),
    remove: (id) => ipcRenderer.invoke('opportunities:remove', id),
  },
  resumes: {
    list: () => ipcRenderer.invoke('resumes:list'),
    ocrPage: (image) => ipcRenderer.invoke('resumes:ocr-page', image),
    add: (input) => ipcRenderer.invoke('resumes:add', input),
    remove: (id) => ipcRenderer.invoke('resumes:remove', id),
    exportCopy: (input) => ipcRenderer.invoke('resumes:export-copy', input),
  },
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    add: (source) => ipcRenderer.invoke('sources:add', source),
    testRss: (url) => ipcRenderer.invoke('sources:test-rss', { url }),
    testJson: (url, config) => ipcRenderer.invoke('sources:test-json', { url, config }),
    testCsv: (url, config) => ipcRenderer.invoke('sources:test-csv', { url, config }),
    updateEnabled: (id, enabled) => ipcRenderer.invoke('sources:update-enabled', { id, enabled }),
    updateCustomAutomationApproval: (id, approved) => ipcRenderer.invoke('sources:update-custom-automation', { id, approved }),
    remove: (id) => ipcRenderer.invoke('sources:remove', id),
  },
  drafts: {
    list: () => ipcRenderer.invoke('drafts:list'),
    save: (draft) => ipcRenderer.invoke('drafts:save', draft),
    remove: (id) => ipcRenderer.invoke('drafts:remove', id),
  },
  app: {
    summary: () => ipcRenderer.invoke('app:summary'),
    settings: () => ipcRenderer.invoke('app:settings'),
    saveSettings: (settings) => ipcRenderer.invoke('app:save-settings', settings),
    refreshSalaryExchangeRates: () => ipcRenderer.invoke('app:refresh-salary-exchange-rates'),
    clearAiApiKey: () => ipcRenderer.invoke('app:clear-ai-key'),
    generateMessage: (input) => ipcRenderer.invoke('app:generate-message', input),
    runSearch: () => ipcRenderer.invoke('app:run-search'),
    createBackup: () => ipcRenderer.invoke('app:create-backup'),
    restoreBackup: () => ipcRenderer.invoke('app:restore-backup'),
    onSearchCompleted: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('app:search-completed', listener)
      return () => ipcRenderer.removeListener('app:search-completed', listener)
    },
    onSearchCompletionNotice: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const counts = payload as { added?: unknown; errors?: unknown }
        if (typeof counts.added !== 'number' || !Number.isInteger(counts.added) || counts.added < 0) return
        if (typeof counts.errors !== 'number' || !Number.isInteger(counts.errors) || counts.errors < 0) return
        if (counts.added === 0 && counts.errors === 0) return
        callback({ added: counts.added, errors: counts.errors })
      }
      ipcRenderer.on('app:search-completion-notice', listener)
      ipcRenderer.send('app:search-completion-notice-listener-ready')
      return () => ipcRenderer.removeListener('app:search-completion-notice', listener)
    },
    onSearchFailed: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, count: unknown) => {
        callback(typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 1)
      }
      ipcRenderer.on('app:search-failed', listener)
      return () => ipcRenderer.removeListener('app:search-failed', listener)
    },
    onFollowUpReminder: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const delivery = payload as { deliveryId?: unknown; count?: unknown }
        if (typeof delivery.deliveryId !== 'string' || typeof delivery.count !== 'number' || !Number.isInteger(delivery.count) || delivery.count < 1) return
        callback(delivery.count, delivery.deliveryId)
      }
      ipcRenderer.on('app:follow-up-reminder', listener)
      ipcRenderer.send('app:follow-up-reminder-listener-ready')
      return () => ipcRenderer.removeListener('app:follow-up-reminder', listener)
    },
    acknowledgeFollowUpReminder: (deliveryId) => ipcRenderer.send('app:follow-up-reminder-shown', deliveryId),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  },
}

contextBridge.exposeInMainWorld('radar', api)
