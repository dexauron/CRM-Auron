/** Инициалы для аватара: «Адам Чеченский» → «АЧ», одно слово → одна буква. */
export function initials(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}
