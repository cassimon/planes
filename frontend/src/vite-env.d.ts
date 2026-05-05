/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_USERS_OPEN_REGISTRATION?: string
  readonly VITE_NOMAD_OAUTH_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
