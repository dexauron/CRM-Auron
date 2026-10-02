/**
 * Телефоны храним в одном формате: +7XXXXXXXXXX (ТЗ, раздел 6).
 * Принимаем записи 8…, 7…, +7… и 10 цифр без кода страны; остальное — null («на проверку»).
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return null;
  }
  // Российские номера: мобильные начинаются с 9, городские — с 3, 4 или 8.
  if (!/^[3489]\d{9}$/.test(national)) return null;
  return `+7${national}`;
}

/** +79000000001 → «+7 900 000-00-01» */
export function formatPhone(normalized: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(normalized);
  if (!m) return normalized;
  return `+7 ${m[1] ?? ''} ${m[2] ?? ''}-${m[3] ?? ''}-${m[4] ?? ''}`;
}
