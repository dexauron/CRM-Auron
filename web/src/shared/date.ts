// Даты в интерфейсе — по времени магазина (Грозный, UTC+3).
const shortDateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

/** «05.10, 14:30» */
export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : shortDateTime.format(date);
}

const dayLong = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});

/** Дата без времени «2026-10-02» → «2 октября 2026 г.» (без сдвига по часовому поясу). */
export function formatDay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? dayLong.format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : '—';
}

/** Момент времени → «02.10.2026» по времени магазина. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dayShort.format(date);
}

/** «2026-10-02» → «02.10.2026». */
export const isoDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
};

/** Период отчёта «2026-09-01»…«2026-09-30» → «01.09.2026 – 30.09.2026»; один день — одна дата. */
export function formatPeriod(from: string, to: string): string {
  return from === to ? isoDay(from) : `${isoDay(from)} – ${isoDay(to)}`;
}

const isoToday = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' });

/** Сегодня по времени магазина: «2026-10-02». */
export function todayIso(now: Date = new Date()): string {
  return isoToday.format(now);
}
