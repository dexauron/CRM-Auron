import { describe, expect, it } from 'vitest';
import { isOffImage } from './openFoodFacts';

describe('КАТ-7: фото только с сайтов Open Food Facts', () => {
  it('свои сайты фото — да', () => {
    expect(isOffImage('https://images.openfoodfacts.org/images/products/460/000/000/0015/front_ru.3.400.jpg')).toBe(true);
    expect(isOffImage('https://images.openbeautyfacts.org/images/products/1/front.jpg')).toBe(true);
    expect(isOffImage('https://images.openpetfoodfacts.org/x.jpg')).toBe(true);
  });
  it('чужие адреса, http и подделки — нет', () => {
    expect(isOffImage('http://images.openfoodfacts.org/x.jpg')).toBe(false);
    expect(isOffImage('https://images.openfoodfacts.org.evil.example/x.jpg')).toBe(false);
    expect(isOffImage('https://evil.example/images.openfoodfacts.org/x.jpg')).toBe(false);
    expect(isOffImage('https://storage.example.io/storage/v1/object/public/product-photos/x.jpg')).toBe(false);
    expect(isOffImage('не адрес')).toBe(false);
  });
});
