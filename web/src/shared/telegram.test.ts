import { describe, expect, it } from 'vitest';
import { looksLikeTelegramLaunch, themeVariables } from './telegram';

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

describe('themeVariables', () => {
  it('сгруппированный вид: фон страницы — secondary, ячейки — section или bg', () => {
    expect(themeVariables({ secondary_bg_color: '#efeff4', bg_color: '#ffffff' })).toEqual({
      '--bg': '#efeff4',
      '--surface': '#ffffff',
    });
    expect(themeVariables({ section_bg_color: '#1c1c1e', bg_color: '#000000' })['--surface']).toBe('#1c1c1e');
  });

  it('не пропускает в CSS ничего, кроме цвета', () => {
    expect(themeVariables({ text_color: 'red;background:url(x)', hint_color: '#zzz' })).toEqual({});
  });
});
