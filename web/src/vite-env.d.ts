/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_TELEGRAM_BOT?: string;
  readonly VITE_STORE_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
