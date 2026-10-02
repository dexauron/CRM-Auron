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
