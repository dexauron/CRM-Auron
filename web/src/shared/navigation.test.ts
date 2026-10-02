import { describe, expect, it } from 'vitest';
import { catalogListHash, parentHash, screenFromHash } from './navigation';

const id = '10000000-0000-4000-8000-000000000001';
describe('КАТ-6: адрес и возврат из карточки', () => {
  it.each(['missing_price', 'below_cost', 'no_markup', 'duplicate_barcodes'])('карточка возвращается в свой фильтр %s', (kind) => {
    const screen = screenFromHash(`#catalog/tools/${kind}/item/${id}`);
    expect(screen).toMatchObject({ name: 'catalog', tools: true, issueKind: kind, productId: id });
    expect(parentHash(screen)).toBe(`catalog/tools/${kind}`);
    if (screen.name === 'catalog') expect(catalogListHash(screen)).toBe(`catalog/tools/${kind}`);
  });
  it('прямая ссылка на фильтр ведёт в инструменты, оттуда — в каталог', () => {
    expect(parentHash(screenFromHash('#catalog/tools/below_cost'))).toBe('catalog/tools');
    expect(parentHash(screenFromHash('#catalog/tools'))).toBe('catalog');
  });
  it('сохраняет адреса каталога и групп', () => {
    expect(parentHash(screenFromHash(`#catalog/${id}/item/${id}`))).toBe(`catalog/${id}`);
    expect(parentHash(screenFromHash(`#catalog/item/${id}`))).toBe('catalog');
    expect(parentHash(screenFromHash('#catalog'))).toBe('');
  });
  it.each(['#catalog/tools/unknown', '#catalog/tools/below_cost/item/no-id', '#catalog/tools/../staff'])('не принимает неизвестный адрес %s', (hash) => {
    expect(screenFromHash(hash)).toEqual({ name: 'home' });
  });
});
