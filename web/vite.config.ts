import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Политика безопасности контента (CSP). GitHub Pages не даёт задавать заголовки,
// поэтому она вставляется meta-тегом — только в сборку: в режиме разработки Vite
// подключает стили встроенными тегами, и строгая политика ему мешает.
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api = apiUrl ? new URL(apiUrl) : null;
  // oauth.telegram.org — ответ окна входа с ПК, если оно закрылось без сообщения (shared/telegramLogin.ts).
  const connect = ["'self'", 'https://oauth.telegram.org'];
  const images = ["'self'", 'data:', 'blob:'];
  if (api) {
    connect.push(api.origin, `wss://${api.host}`);
    images.push(api.origin);
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self'",
    `img-src ${images.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  // Адрес сайта на GitHub Pages: https://<пользователь>.github.io/CRM-Auron/
  const base = env.VITE_BASE_PATH ?? '/CRM-Auron/';
  return {
    base,
    plugins: [
      react(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL ?? ''),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Way Market',
          short_name: 'Way Market',
          description: 'Каталог, покупатели, поставщики, сотрудники и финансы магазина',
          lang: 'ru',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f2f2f7',
          theme_color: '#f2f2f7',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Ответы сервера не кэшируются сервис-воркером: в них могут быть личные данные.
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
