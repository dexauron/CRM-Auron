import { describe, expect, it } from 'vitest';
import { matchSupplier, parseSupplier, SuppliersError, whatsappUrl } from './suppliers';

const row = {
  id: 's1', name: 'ООО Тестовый опт', kind: 'ooo', note: null, deleted_at: null,
  supplier_contacts: [
    { id: 'c1', role: 'agent', name: 'Тестовый ТП', phone: '+79000000001', brands: 'Бренд Ё', note: null, deleted_at: null },
    { id: 'c2', role: 'office', name: null, phone: '+79000000002', brands: null, note: null, deleted_at: '2026-10-02T00:00:00Z' },
  ],
};

describe('ПСТ-1: справочник поставщиков', () => {
  it('разбирает поставщика; удалённые контакты не показываются', () => {
    const s = parseSupplier(row);
    expect(s).toMatchObject({ id: 's1', kind: 'ooo', deleted: false });
    expect(s.contacts.map((c) => c.id)).toEqual(['c1']);
  });
  it.each([{ kind: 'zao' }, { name: 5 }, { supplier_contacts: null }, { supplier_contacts: [{ id: 'c', role: 'boss' }] }])(
    'отклоняет неверную строку %o', (bad) => {
      expect(() => parseSupplier({ ...row, ...bad })).toThrow(SuppliersError);
    });
  it('поиск: название, ТП, бренд (ё = е), цифры телефона', () => {
    const s = parseSupplier(row);
    expect(matchSupplier(s, 'тестовый')).toBe(true);
    expect(matchSupplier(s, 'бренд е')).toBe(true);
    expect(matchSupplier(s, '000-00-01')).toBe(true);
    expect(matchSupplier(s, '0000002')).toBe(false);
    expect(matchSupplier(s, 'другой')).toBe(false);
    expect(matchSupplier(s, '  ')).toBe(true);
  });
  it('ссылка WhatsApp — только цифры номера', () => {
    expect(whatsappUrl('+79000000001')).toBe('https://wa.me/79000000001');
  });
});
