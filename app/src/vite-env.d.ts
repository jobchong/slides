/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODEL_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_MODEL_SERVICE_URL?: string;
  readonly VITE_UPLOAD_API_URL?: string;
  readonly VITE_SERVER_URL?: string;
  readonly VITE_DEFAULT_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
