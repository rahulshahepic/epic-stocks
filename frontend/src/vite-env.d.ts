/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin the API is served from. Empty/unset = same origin. */
  readonly VITE_API_BASE?: string
  readonly VITE_APP_ENV?: string
  readonly VITE_COMMIT_SHA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
