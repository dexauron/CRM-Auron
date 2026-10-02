// Единственное место, где приложение знает о сервере (ТЗ, раздел 4).
// Компоненты работают только через функции из src/api/.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

export const isServerConfigured = Boolean(url && key);

export function api(): SupabaseClient {
  if (!url || !key) {
    throw new Error('Сервер не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY');
  }
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export type ServerStatus = 'ok' | 'not-configured' | 'unreachable';

/** Проверка связи: запрос к служебному адресу входа, без личных данных. */
export async function checkServer(signal?: AbortSignal): Promise<ServerStatus> {
  if (!url || !key) return 'not-configured';
  try {
    const init: RequestInit = { headers: { apikey: key } };
    if (signal) init.signal = signal;
    const response = await fetch(`${url}/auth/v1/health`, init);
    return response.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
