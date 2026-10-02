import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

// Только вымышленные номера: настоящих персональных данных в репозитории быть не должно.
describe('normalizePhone', () => {
  it('приводит разные записи к +7XXXXXXXXXX', () => {
    expect(normalizePhone('+7 900 000-00-01')).toBe('+79000000001');
    expect(normalizePhone('89000000002')).toBe('+79000000002');
    expect(normalizePhone('79000000003')).toBe('+79000000003');
    expect(normalizePhone('9000000004')).toBe('+79000000004');
    expect(normalizePhone('8 (900) 000-00-05')).toBe('+79000000005');
  });
  it('битые номера, как в выгрузке 1С, отправляет на проверку', () => {
    expect(normalizePhone('+7900000')).toBeNull(); // не хватает цифр
    expect(normalizePhone('+779000000006')).toBeNull(); // лишняя 7
    expect(normalizePhone('+790000000071')).toBeNull(); // лишняя цифра
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('Контрагент')).toBeNull();
  });
  it('отклоняет номера с несуществующим началом', () => {
    expect(normalizePhone('+71234567890')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('показывает номер по-человечески', () => {
    expect(formatPhone('+79000000001')).toBe('+7 900 000-00-01');
  });
});
