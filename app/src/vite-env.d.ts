/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY: string;
  readonly VITE_UPLOAD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
