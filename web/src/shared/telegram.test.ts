import { describe, expect, it } from 'vitest';
import { looksLikeTelegramLaunch } from './telegram';

describe('looksLikeTelegramLaunch', () => {
  it('узнаёт запуск из Telegram по параметрам в адресе', () => {
    expect(looksLikeTelegramLaunch('#tgWebAppData=query_id%3DAA&tgWebAppVersion=8.0', null)).toBe(true);
    expect(looksLikeTelegramLaunch('#tgWebAppPlatform=ios', null)).toBe(true);
  });
  it('узнаёт перезагрузку внутри Telegram по сохранённым параметрам', () => {
    expect(looksLikeTelegramLaunch('', '{"tgWebAppData":"x"}')).toBe(true);
  });
  it('в обычном браузере SDK не нужен', () => {
    expect(looksLikeTelegramLaunch('', null)).toBe(false);
    expect(looksLikeTelegramLaunch('#catalog', null)).toBe(false);
  });
});
