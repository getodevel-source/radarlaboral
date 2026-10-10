import type { RadarApi } from './types'

declare global {
  interface Window {
    radar: RadarApi
  }
}

export {}
