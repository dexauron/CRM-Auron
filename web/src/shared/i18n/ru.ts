// Все тексты интерфейса в одном месте — задел на другие языки (ТЗ, раздел 10).
export const ru = {
  appName: 'Way Market',
  appSubtitle: 'Магазин 24/7',
  platform: {
    telegram: 'Telegram',
    installed: 'Приложение',
    browser: 'Браузер',
  },
  server: {
    checking: 'Проверяю связь с сервером…',
    ok: 'Сервер на связи',
    notConfigured: 'Сервер не настроен',
    unreachable: 'Нет связи с сервером',
  },
  offline: 'Нет интернета. Каталог доступен, изменения отправятся позже.',
  update: {
    text: 'Доступна новая версия приложения.',
    action: 'Обновить',
    later: 'Позже',
  },
  modulesTitle: 'Разделы',
  modules: {
    catalog: { name: 'Каталог', hint: 'Товары, цены, штрихкоды, наличие' },
    suppliers: { name: 'Поставщики', hint: 'Заказы, поставки, долги, договорённости' },
    staff: { name: 'Сотрудники', hint: 'Смены, табель, задачи, регламенты' },
    customers: { name: 'Покупатели', hint: 'Списки покупок, отзывы, рассылки' },
    finance: { name: 'Касса и финансы', hint: 'Z-отчёты, движение денег, отчёты' },
  },
  stage: (n: number) => `Этап ${n}`,
  soon: 'Скоро',
  loginSoon: 'Вход через Telegram появится на следующем шаге.',
} as const;
