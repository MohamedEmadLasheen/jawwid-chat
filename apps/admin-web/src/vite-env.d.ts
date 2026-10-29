/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_REALTIME_URL?: string
  /** PD-29 audio: the lessons site's origin; only frames on it are handed Quran audio. */
  readonly VITE_LESSONS_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
