import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { checkServer, isServerConfigured, type ServerStatus } from './api/client';
import { Account } from './modules/common/Account';
import { SecondFactor } from './modules/common/SecondFactor';
import { useAccount } from './modules/common/useAccount';
import { Team } from './modules/staff/Team';
import { CatalogScreen } from './modules/catalog/CatalogScreen';
import { ru } from './shared/i18n/ru';
import { applyTelegramTheme, loadTelegram, type TelegramWebApp } from './shared/telegram';
import { Icon } from './shared/ui/icons';
import { IconTile, Row, Section } from './shared/ui/List';
import { LargeTitle } from './shared/ui/LargeTitle';
import { catalogListHash, parentHash, screenFromHash } from './shared/navigation';

const modules = [
  { id: 'catalog', stage: 1, icon: 'bag', color: 'blue' },
  { id: 'suppliers', stage: 2, icon: 'truck', color: 'orange' },
  { id: 'staff', stage: 3, icon: 'people', color: 'indigo' },
  { id: 'customers', stage: 4, icon: 'heart', color: 'pink' },
  { id: 'finance', stage: 5, icon: 'chart', color: 'green' },
] as const;

export function App() {
  // undefined — ещё выясняем, открыто ли приложение из Telegram.
  const [telegram, setTelegram] = useState<TelegramWebApp | null | undefined>(undefined);
  const [server, setServer] = useState<ServerStatus | 'checking'>('checking');
  const [online, setOnline] = useState(() => navigator.onLine);
  // Экраны — через адрес (#catalog): кнопка «Назад» браузера и телефона работает как в приложении.
  const [screen, setScreen] = useState(() => screenFromHash(window.location.hash));
  const account = useAccount(telegram, isServerConfigured);
  const ready = account.state.kind === 'ready' ? account.state : null;
  const me = ready?.me ?? null;
  // Права владельца действуют только после кода из аутентификатора — до этого экран команды не нужен.
  const ownerOf = ready?.secondFactor === 'ok' ? me?.memberships.find((m) => m.role === 'owner') : undefined;
  // Магазины, где у человека есть одна из ролей (только после второго фактора — без него сервер прав не даст).
  const orgsWithRole = (roles: readonly string[]) =>
    ready?.secondFactor === 'ok' ? (me?.memberships ?? []).filter((m) => roles.includes(m.role)).map((m) => m.orgId) : [];
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
      }
      setTelegram(app);
    });
    return () => {
      active = false;
    };
  }, []);

  // Переход вперёд — экран сверху; «Назад» — к тому месту списка, где человек был (как в iOS).
  const forward = useRef(false);
  const depth = useRef(0);
  const scrolls = useRef(new Map<string, number>());
  const scrollTarget = useRef(0);

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    const update = (event: HashChangeEvent) => {
      scrolls.current.set(new URL(event.oldURL).hash, window.scrollY);
      const hash = window.location.hash;
      if (forward.current) {
        depth.current += 1;
        scrolls.current.delete(hash);
      } else {
        depth.current = Math.max(0, depth.current - 1);
      }
      scrollTarget.current = forward.current ? 0 : (scrolls.current.get(hash) ?? 0);
      forward.current = false;
      setScreen(screenFromHash(hash));
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useLayoutEffect(() => {
    window.scrollTo(0, scrollTarget.current);
  }, [screen]);

  const navigate = (hash: string) => {
    if (`#${hash}` === window.location.hash) return;
    forward.current = true;
    window.location.hash = hash;
  };

  const goBack = useCallback(() => {
    if (depth.current > 0) window.history.back();
    else window.location.replace(`#${parentHash(screen)}`);
  }, [screen]);

  // В Telegram — его собственная кнопка «Назад» в шапке.
  useEffect(() => {
    const button = telegram?.BackButton;
    if (!button) return;
    if (screen.name === 'home') {
      button.hide();
      return;
    }
    button.onClick(goBack);
    button.show();
    return () => {
      button.offClick(goBack);
      button.hide();
    };
  }, [telegram, screen, goBack]);

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

  // Минимализм: состояние связи показываем, только когда что-то не так.
  const problem = !online
    ? ru.offline
    : server === 'unreachable'
      ? ru.server.unreachable
      : server === 'not-configured'
        ? ru.server.notConfigured
        : null;

  if (screen.name === 'catalog' && isServerConfigured) {
    const groupHash = catalogListHash(screen);
    return (
      <div className="app">
        <CatalogScreen
          editableOrgIds={orgsWithRole(['owner', 'manager'])}
          privilegedOrgIds={orgsWithRole(['owner', 'manager', 'accountant'])}
          groupId={screen.groupId}
          productId={screen.productId}
          tools={screen.tools}
          issueKind={screen.issueKind}
          viewerId={me?.userId ?? null}
          accountLoading={account.state.kind === 'loading'}
          onOpenTools={(kind) => navigate(`catalog/tools${kind ? `/${kind}` : ''}`)}
          onOpenGroup={(id) => navigate(`catalog/${id}`)}
          onOpenProduct={(id) => navigate(`${groupHash}/item/${id}`)}
          onBack={goBack}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <LargeTitle title={ru.appName} subtitle={ru.appSubtitle} />

      {problem && (
        <p className="notice tone-warn" role="status">
          <Icon name="warning" />
          {problem}
        </p>
      )}

      {needRefresh && (
        <Section footer={ru.update.text}>
          <Row
            leading={<Icon name="refresh" className="row-icon" />}
            title={ru.update.action}
            tone="link"
            onClick={() => void updateServiceWorker(true)}
          />
          <Row title={ru.update.later} tone="muted" inset="icon" onClick={() => setNeedRefresh(false)} />
        </Section>
      )}

      <main>
        {isServerConfigured && <Account
            state={account.state}
            inTelegram={Boolean(telegram)}
            onRetry={account.retry}
            onBrowserSignIn={account.signInFromBrowser}
          />}
        {ready && ready.secondFactor !== 'ok' && <SecondFactor mode={ready.secondFactor} onDone={account.retry} />}
        {me && ownerOf && (
          <Team orgId={ownerOf.orgId} orgName={ownerOf.orgName} selfId={me.userId} telegram={telegram ?? null} />
        )}
        <Section title={ru.modulesTitle} id="modules-title" footer={ru.modulesFooter}>
          {modules.map(({ id, stage, icon, color }) =>
            id === 'catalog' && isServerConfigured ? (
              <Row
                key={id}
                leading={<IconTile icon={icon} color={color} />}
                title={ru.modules[id].name}
                subtitle={ru.modules[id].hint}
                chevron
                onClick={() => navigate('catalog')}
              />
            ) : (
              <Row
                key={id}
                leading={<IconTile icon={icon} color={color} />}
                title={ru.modules[id].name}
                subtitle={ru.modules[id].hint}
                tone="muted"
                trailing={<span className="row-detail">{ru.stage(stage)}</span>}
              />
            ),
          )}
        </Section>
        {me && (
          <Section>
            <Row title={ru.account.signOut} tone="bad" center onClick={account.signOut} />
          </Section>
        )}
      </main>
    </div>
  );
}
