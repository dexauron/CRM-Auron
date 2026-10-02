-- Каталог (ТЗ 5.1, КАТ-1 и КАТ-4). Видимость по матрице раздела 2:
-- название, коды, цена на полке, наличие «есть / нет», дата поступления — всем, кому открыт каталог (и гостю);
-- закупка, остаток числом и примечание — в отдельной таблице product_internals, только владелец, управляющий,
-- бухгалтер (со вторым фактором). Правило доступа скрывает строки, а не столбцы — поэтому таблицы разные.

-- Магазин с открытым каталогом виден гостю: по короткому имени (slug) приложение находит его без входа.
alter table public.organizations
  add column slug text unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  add column catalog_public boolean not null default false;

grant select on public.organizations to anon;
create policy organizations_public on public.organizations for select to anon, authenticated
  using (deleted_at is null and catalog_public);

-- Каталог магазина открыт: всем, если магазин его опубликовал, иначе — только участникам.
create function private.catalog_visible(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o where o.id = p_org and o.deleted_at is null and o.catalog_public
  ) or private.is_member(p_org);
$$;
revoke all on function private.catalog_visible(uuid) from public;
grant usage on schema private to anon;
grant execute on function private.catalog_visible(uuid) to anon, authenticated;

create type public.product_unit as enum ('pcs', 'kg');

create table public.product_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  parent_id uuid references public.product_groups (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 200),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_groups_org_idx on public.product_groups (org_id);
create index product_groups_parent_idx on public.product_groups (parent_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  group_id uuid references public.product_groups (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 300),
  cash_code text check (length(cash_code) between 1 and 64),
  article text check (length(article) between 1 and 64),
  unit public.product_unit not null default 'pcs',
  is_weighted boolean not null default false,
  -- Деньги — целые копейки.
  retail_price bigint check (retail_price >= 0),
  -- Наличие без числа (КАТ-4); число — в product_internals, отсюда его обновляет триггер.
  in_stock boolean,
  arrival_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, cash_code),
  unique (id, org_id)
);
create index products_org_idx on public.products (org_id, id);
create index products_group_idx on public.products (group_id);

-- У товара может быть несколько штрихкодов; магазин у штрихкода всегда тот же, что у товара.
create table public.product_barcodes (
  product_id uuid not null,
  org_id uuid not null,
  barcode text not null check (barcode ~ '^[0-9A-Za-z-]{1,64}$'),
  primary key (product_id, barcode),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create index product_barcodes_lookup_idx on public.product_barcodes (org_id, barcode);
create index product_barcodes_fk_idx on public.product_barcodes (product_id, org_id);

-- Закрытые сведения о товаре: закупка, остаток, примечание.
create table public.product_internals (
  product_id uuid primary key,
  org_id uuid not null,
  purchase_price bigint check (purchase_price >= 0),
  stock numeric(14, 3),
  note text check (length(note) <= 2000),
  updated_at timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create index product_internals_fk_idx on public.product_internals (product_id, org_id);

-- История цен: для «подорожало» (КАТ-6) и разборов. Пишут только триггеры.
create table public.price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null,
  org_id uuid not null,
  kind text not null check (kind in ('retail', 'purchase')),
  price bigint check (price >= 0),
  changed_at timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create index price_history_product_idx on public.price_history (product_id, org_id, changed_at desc);

-- ── Триггеры ────────────────────────────────────────────────────────

create function private.track_retail_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.retail_price is distinct from old.retail_price then
    insert into public.price_history (product_id, org_id, kind, price) values (new.id, new.org_id, 'retail', new.retail_price);
  end if;
  return new;
end;
$$;

-- Закупка → история; остаток → «есть / нет» в карточке товара (число наружу не уходит).
create function private.sync_internals() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.purchase_price is distinct from old.purchase_price then
    insert into public.price_history (product_id, org_id, kind, price) values (new.product_id, new.org_id, 'purchase', new.purchase_price);
  end if;
  if tg_op = 'INSERT' or new.stock is distinct from old.stock then
    update public.products set in_stock = case when new.stock is null then null else new.stock > 0 end
    where id = new.product_id;
  end if;
  return new;
end;
$$;

revoke all on function private.track_retail_price() from public;
revoke all on function private.sync_internals() from public;

create trigger product_groups_touch before update on public.product_groups for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger product_internals_touch before update on public.product_internals for each row execute function private.touch_updated_at();

create trigger products_retail_history after insert or update of retail_price on public.products
  for each row execute function private.track_retail_price();
create trigger product_internals_sync after insert or update on public.product_internals
  for each row execute function private.sync_internals();

create trigger product_groups_audit after insert or update or delete on public.product_groups for each row execute function private.audit();
create trigger products_audit after insert or update or delete on public.products for each row execute function private.audit();
create trigger product_internals_audit after insert or update or delete on public.product_internals for each row execute function private.audit();

-- ── Права ───────────────────────────────────────────────────────────

alter table public.product_groups enable row level security;
alter table public.products enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.product_internals enable row level security;
alter table public.price_history enable row level security;

revoke all on public.product_groups, public.products, public.product_barcodes, public.product_internals,
  public.price_history from anon, authenticated;

-- Открытая часть каталога: гость и все участники магазина — чтение; владелец и управляющий — правка.
grant select on public.product_groups, public.products, public.product_barcodes to anon, authenticated;
grant insert, update, delete on public.product_groups, public.products, public.product_barcodes to authenticated;

create policy product_groups_select on public.product_groups for select to anon, authenticated
  using (private.catalog_visible(org_id));
create policy product_groups_insert on public.product_groups for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_groups_update on public.product_groups for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_groups_delete on public.product_groups for delete to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));

-- Активные товары — всем, кому открыт каталог; снятые с продажи — только владельцу и управляющему.
create policy products_select on public.products for select to anon, authenticated
  using (active and private.catalog_visible(org_id));
create policy products_select_inactive on public.products for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy products_update on public.products for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy products_delete on public.products for delete to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));

create policy product_barcodes_select on public.product_barcodes for select to anon, authenticated
  using (private.catalog_visible(org_id));
create policy product_barcodes_insert on public.product_barcodes for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_barcodes_delete on public.product_barcodes for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

-- Закрытая часть: читают владелец, управляющий, бухгалтер; меняет только владелец (матрица: П / Ч / Ч).
grant select, insert, update, delete on public.product_internals to authenticated;
create policy product_internals_select on public.product_internals for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[]));
create policy product_internals_insert on public.product_internals for insert to authenticated
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
create policy product_internals_update on public.product_internals for update to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]))
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
create policy product_internals_delete on public.product_internals for delete to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));

grant select on public.price_history to authenticated;
create policy price_history_select on public.price_history for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[]));
