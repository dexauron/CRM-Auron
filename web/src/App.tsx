import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Me } from './api/auth';
import { checkServer, isServerConfigured, type ServerStatus } from './api/client';
import { Account } from './modules/common/Account';
import { Team } from './modules/staff/Team';
import { ru } from './shared/i18n/ru';
import { applyTelegramTheme, loadTelegram, type TelegramWebApp } from './shared/telegram';

type Platform = keyof typeof ru.platform;

function detectPlatform(): Platform {
  return window.matchMedia('(display-mode: standalone)').matches ? 'installed' : 'browser';
}

const modules = [
  { id: 'catalog', stage: 1 },
  { id: 'suppliers', stage: 2 },
  { id: 'staff', stage: 3 },
  { id: 'customers', stage: 4 },
  { id: 'finance', stage: 5 },
] as const;

const statusText: Record<ServerStatus | 'checking', string> = {
  checking: ru.server.checking,
  ok: ru.server.ok,
  'not-configured': ru.server.notConfigured,
  unreachable: ru.server.unreachable,
};

export function App() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  // undefined — ещё выясняем, открыто ли приложение из Telegram.
  const [telegram, setTelegram] = useState<TelegramWebApp | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const ownerOf = me?.memberships.find((m) => m.role === 'owner');
  const [server, setServer] = useState<ServerStatus | 'checking'>('checking');
  const [online, setOnline] = useState(() => navigator.onLine);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    let active = true;
    void loadTelegram().then((app) => {
      if (!active) return;
      if (app) {
        applyTelegramTheme(app);
        app.ready();
        app.expand();
        setPlatform('telegram');
      }
      setTelegram(app);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkServer(controller.signal).then(setServer);
    return () => controller.abort();
  }, [online]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="title">{ru.appName}</h1>
          <p className="subtitle">{ru.appSubtitle}</p>
        </div>
        <div className="chips">
          <span className="chip">{ru.platform[platform]}</span>
          <span className={`chip chip-${server}`}>{statusText[server]}</span>
        </div>
      </header>

      {!online && <p className="banner banner-warning" role="status">{ru.offline}</p>}

      {needRefresh && (
        <div className="banner" role="status">
          <span>{ru.update.text}</span>
          <div className="banner-actions">
            <button type="button" className="button" onClick={() => void updateServiceWorker(true)}>
              {ru.update.action}
            </button>
            <button type="button" className="button button-quiet" onClick={() => setNeedRefresh(false)}>
              {ru.update.later}
            </button>
          </div>
        </div>
      )}

      <main>
        {isServerConfigured && <Account telegram={telegram} onMe={setMe} />}
        {me && ownerOf && (
          <Team orgId={ownerOf.orgId} orgName={ownerOf.orgName} selfId={me.userId} telegram={telegram ?? null} />
        )}
        <h2 className="section-title">{ru.modulesTitle}</h2>
        <ul className="modules">
          {modules.map(({ id, stage }) => (
            <li key={id} className="module">
              <div className="module-head">
                <span className="module-name">{ru.modules[id].name}</span>
                <span className="module-stage">{ru.stage(stage)}</span>
              </div>
              <p className="module-hint">{ru.modules[id].hint}</p>
              <span className="module-soon">{ru.soon}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
