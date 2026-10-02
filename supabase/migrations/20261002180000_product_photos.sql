-- Фото товаров (КАТ-7). Файлы — в Supabase Storage, корзина product-photos: читать может каждый (каталог
-- открытый, на фото только товар), добавлять и удалять — владелец и управляющий своего магазина со вторым фактором.
-- Путь файла: <магазин>/<товар>/<имя>.jpg и уменьшенная копия <имя>-t.jpg; права проверяются по первой папке.
-- Служебные данные снимка (EXIF, в том числе геолокация) удаляет телефон: фото перерисовывается перед загрузкой.

create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  org_id uuid not null,
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]{8,40}\.jpg$'),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade,
  check (split_part(path, '/', 1) = org_id::text and split_part(path, '/', 2) = product_id::text)
);
create index product_photos_product_idx on public.product_photos (product_id, org_id, sort);

alter table public.product_photos enable row level security;
revoke all on public.product_photos from anon, authenticated;
grant select on public.product_photos to anon, authenticated;
grant insert, update, delete on public.product_photos to authenticated;

create policy product_photos_select on public.product_photos for select to anon, authenticated
  using (private.catalog_visible(org_id));
create policy product_photos_insert on public.product_photos for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_photos_update on public.product_photos for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_photos_delete on public.product_photos for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

create trigger product_photos_audit after insert or update or delete on public.product_photos
  for each row execute function private.audit();

-- Первая папка пути — id магазина; не-uuid (чужой формат пути) — не магазин, прав нет.
create function private.path_org(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function private.path_org(text) from public;
grant execute on function private.path_org(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy product_photos_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]{8,40}(-t)?\.jpg$'
    and private.has_role(private.path_org(name), array['owner', 'manager']::public.app_role[])
  );
create policy product_photos_remove on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-photos'
    and private.has_role(private.path_org(name), array['owner', 'manager']::public.app_role[])
  );
-- Удалять через Storage API можно только то, что видно выборкой: своим ролям — файлы своего магазина.
create policy product_photos_list on storage.objects for select to authenticated
  using (
    bucket_id = 'product-photos'
    and private.has_role(private.path_org(name), array['owner', 'manager']::public.app_role[])
  );

-- Версия каталога учитывает фото: добавили или удалили — устройства скачают каталог заново.
create or replace function public.catalog_version(p_org uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or not private.catalog_visible(p_org) then
    return null;
  end if;
  return concat_ws(':',
    (select md5(coalesce(string_agg(p.id::text || p.updated_at::text, ',' order by p.id), ''))
       from public.products p where p.org_id = p_org and p.active),
    (select md5(coalesce(string_agg(g.id::text || g.updated_at::text, ',' order by g.id), ''))
       from public.product_groups g where g.org_id = p_org),
    (select md5(coalesce(string_agg(b.product_id::text || b.barcode, ',' order by b.product_id, b.barcode), ''))
       from public.product_barcodes b where b.org_id = p_org),
    (select md5(coalesce(string_agg(f.path || f.sort::text, ',' order by f.path), ''))
       from public.product_photos f where f.org_id = p_org));
end;
$$;
