-- Источник фото (КАТ-7): null — снято в магазине; 'openfoodfacts' — из открытой базы Open Food Facts
-- (и её сестёр Open Products / Beauty / Pet Food Facts). Фото оттуда под лицензией CC BY-SA: карточка
-- товара показывает подпись с источником.
alter table public.product_photos add column source text check (source in ('openfoodfacts'));
