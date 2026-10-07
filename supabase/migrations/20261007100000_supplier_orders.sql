-- Этап 2, ПСТ-2: заказы поставщикам.
--
-- Заказ — ДОКУМЕНТ, а не запись, которую правят как придётся. Поэтому:
--   • удаления нет вовсе: ошибочный заказ отменяют, и он остаётся виден с пометкой «отменён»;
--   • состав меняют только пока заказ «создан» — после подтверждения ТП состав замораживается;
--   • «принят» и «отменён» — конечные состояния, их уже не меняют;
--   • цену в строке заказа клиент НЕ присылает: сервер сам берёт известную закупочную цену этого
--     поставщика (`product_suppliers`) на момент оформления. Значит подделать сумму нельзя, и сотрудник
--     зала оформляет заказ, ни разу не коснувшись денег.
-- Писать в таблицы напрямую нельзя (ни insert, ни update, ни delete): всё только функциями ниже.
-- Так оформление заказа и отметка списка «Закончилось» происходят одним действием, а не тремя.
--
-- Права по матрице ТЗ (раздел 2, строка «Заказы поставщикам»):
--   владелец П · управляющий П · бухгалтер Ч · сотрудник зала «создать и читать» · ТП «свои».
-- У сотрудника зала закупочных цен нет («Закупочные цены, наценка, остатки» — «—»), поэтому прямого
-- чтения таблиц у него нет: он читает заказы функцией, которая денег ему не отдаёт.

-- «Сегодня» у магазина своё: сервер живёт по UTC, а магазин — по Europe/Moscow (поле
-- `organizations.timezone`). Без этого ночью просроченным называлось бы не то, что просрочено на самом деле.
create function private.org_today(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org),
    'Europe/Moscow'))::date;
$$;
revoke all on function private.org_today(uuid) from public;
grant execute on function private.org_today(uuid) to authenticated;

create type public.supplier_order_status as enum ('created', 'confirmed', 'received', 'cancelled');

create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  status public.supplier_order_status not null default 'created',
  -- Когда ждём поставку. Без даты заказ в календарь не попадает, но живёт в списке.
  expected_at date,
  -- Фактическая сумма — её вводит человек при приёмке, и только тогда.
  amount_actual bigint check (amount_actual >= 0 and amount_actual < 100000000000),
  note text check (char_length(note) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  closed_at timestamptz,
  unique (id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers (id, org_id) on delete restrict,
  constraint supplier_orders_actual_when_received
    check (amount_actual is null or status = 'received')
);
create index supplier_orders_supplier_idx on public.supplier_orders (supplier_id, org_id);
create index supplier_orders_calendar_idx on public.supplier_orders (org_id, expected_at)
  where status in ('created', 'confirmed');
create index supplier_orders_created_by_idx on public.supplier_orders (created_by);

-- Строка заказа. Название, код кассы и единица — СНИМОК на момент заказа: товар могут переименовать
-- или убрать из каталога, а заказ должен читаться через полгода так же, как в день оформления.
create table public.supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  cash_code text check (char_length(cash_code) <= 64),
  -- Единица как в каталоге: штуки или килограммы. У строки «от руки» по умолчанию штуки.
  unit public.product_unit not null default 'pcs',
  -- Весовой товар заказывают в килограммах, штучный — в штуках, поэтому дробь обязательна.
  qty numeric(12, 3) not null check (qty > 0 and qty <= 1000000),
  price bigint check (price >= 0 and price < 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.supplier_orders (id, org_id) on delete cascade,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete set null (product_id)
);
create index supplier_order_items_order_idx on public.supplier_order_items (order_id, org_id);
create index supplier_order_items_product_idx on public.supplier_order_items (product_id, org_id);
-- Один товар в заказе одной строкой: иначе «Молоко 3» и «Молоко 2» в одном заказе, и поставщик спросит, сколько же.
create unique index supplier_order_items_once_idx on public.supplier_order_items (order_id, product_id)
  where product_id is not null;

create trigger supplier_orders_touch before update on public.supplier_orders
  for each row execute function private.touch_updated_at();
create trigger supplier_order_items_touch before update on public.supplier_order_items
  for each row execute function private.touch_updated_at();
create trigger supplier_orders_audit after insert or update or delete on public.supplier_orders
  for each row execute function private.audit();
create trigger supplier_order_items_audit after insert or update or delete on public.supplier_order_items
  for each row execute function private.audit();

-- ── Переходы состояний ───────────────────────────────────────────────
-- Разрешено: создан → подтверждён → принят; создан или подтверждён → отменён. Назад — никогда.
create function private.supplier_order_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if old.status in ('received', 'cancelled') then
    raise exception 'Заказ уже закрыт, его не меняют' using errcode = '22023', hint = 'order_closed';
  end if;
  if not (
    (old.status = 'created' and new.status in ('confirmed', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('received', 'cancelled'))
  ) then
    raise exception 'Так состояние заказа не меняется' using errcode = '22023', hint = 'bad_status';
  end if;
  if new.status = 'confirmed' then new.confirmed_at := now(); end if;
  if new.status in ('received', 'cancelled') then new.closed_at := now(); end if;
  return new;
end;
$$;
revoke all on function private.supplier_order_guard() from public;
create trigger supplier_orders_guard before update on public.supplier_orders
  for each row execute function private.supplier_order_guard();

-- Состав меняют только у заказа «создан»: ТП уже подтвердил — значит он подтвердил именно ЭТОТ состав.
create function private.supplier_order_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.supplier_order_status;
begin
  select status into v_status from public.supplier_orders
  where id = coalesce(new.order_id, old.order_id);
  if v_status is distinct from 'created' then
    raise exception 'Состав заказа меняют, пока он не подтверждён' using errcode = '22023', hint = 'order_frozen';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.supplier_order_items_guard() from public;
create trigger supplier_order_items_guard before insert or update or delete on public.supplier_order_items
  for each row execute function private.supplier_order_items_guard();

-- ── Права ────────────────────────────────────────────────────────────
alter table public.supplier_orders enable row level security;
alter table public.supplier_order_items enable row level security;
revoke all on public.supplier_orders, public.supplier_order_items from anon, authenticated;
-- Только чтение. Создают и меняют заказы функции ниже — поэтому подделать цену или сумму нечем.
grant select on public.supplier_orders, public.supplier_order_items to authenticated;

create policy supplier_orders_select on public.supplier_orders for select to authenticated using (
  private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[])
  or (private.has_role(org_id, array['supplier']::public.app_role[])
      and supplier_id in (select private.my_supplier_ids(org_id)))
);
create policy supplier_order_items_select on public.supplier_order_items for select to authenticated using (
  private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[])
  or (private.has_role(org_id, array['supplier']::public.app_role[])
      and order_id in (select o.id from public.supplier_orders o
        where o.org_id = supplier_order_items.org_id
          and o.supplier_id in (select private.my_supplier_ids(supplier_order_items.org_id))))
);

-- ── Позиции заказа ───────────────────────────────────────────────────
-- Разбор присланных позиций и вставка — ОДИН раз: этим занимаются и оформление заказа, и правка
-- состава, и расходиться они не должны. Иначе заказ, оформленный из списка «Закончилось», и тот же
-- заказ после правки количества считались бы по разным правилам.
create function private.supplier_order_fill(p_org uuid, p_order uuid, p_supplier uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'В заказе нет ни одной позиции' using errcode = '22023', hint = 'empty_order';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Слишком много позиций: не больше 500' using errcode = '22023', hint = 'too_many';
  end if;

  with src as (
    select x.product_id, btrim(x.name) as name, x.qty
    from jsonb_to_recordset(p_items) as x(product_id uuid, name text, qty numeric)
  ), ok as (
    -- Повтор одного товара в присланном списке — берём большее количество, а не складываем:
    -- интерфейс так не делает, а вот ошибиться и прислать то же дважды он может.
    select distinct on (coalesce(s.product_id::text, lower(s.name)))
      s.product_id, case when s.product_id is null then s.name end as name, s.qty
    from src s
    where s.qty > 0 and s.qty <= 1000000
      and (s.product_id is not null or char_length(coalesce(s.name, '')) between 1 and 300)
    order by coalesce(s.product_id::text, lower(s.name)), s.qty desc
  )
  insert into public.supplier_order_items (org_id, order_id, product_id, name, cash_code, unit, qty, price)
  select p_org, p_order, p.id,
    coalesce(p.name, o.name), p.cash_code, coalesce(p.unit, 'pcs'), round(o.qty, 3),
    (select ps.price from public.product_suppliers ps
     where ps.org_id = p_org and ps.product_id = p.id and ps.supplier_id = p_supplier)
  from ok o
  left join public.products p on p.id = o.product_id and p.org_id = p_org
  -- Товар чужого магазина молча не превращаем в строку «от руки»: такую позицию просто не берём.
  where p.id is not null or (o.product_id is null and o.name is not null);

  select count(*) into v_count from public.supplier_order_items where order_id = p_order;
  if v_count = 0 then
    raise exception 'Ни одна позиция не подошла: товары не из этого магазина' using errcode = '22023', hint = 'empty_order';
  end if;
  return v_count;
end;
$$;
revoke all on function private.supplier_order_fill(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── Оформление заказа ────────────────────────────────────────────────
-- p_items: [{product_id, qty}] для товара из каталога или [{name, qty}] для того, чего в каталоге нет.
-- p_marks: отметки «Закончилось на полке», которые этот заказ закрывает — помечаем заказанными тем же действием.
-- Цену берём из `product_suppliers` этого поставщика; нет цены — строка без цены, сумма будет неполной,
-- и интерфейс об этом честно скажет.
create function public.supplier_order_create(
  p_org uuid, p_supplier uuid, p_expected_at date default null,
  p_items jsonb default '[]'::jsonb, p_marks uuid[] default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid;
begin
  if not private.has_role(p_org, array['owner', 'manager', 'staff']::public.app_role[]) then
    raise exception 'Нет прав оформлять заказ' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers s
                 where s.id = p_supplier and s.org_id = p_org and s.deleted_at is null) then
    raise exception 'Поставщик не найден' using errcode = '22023', hint = 'no_supplier';
  end if;

  insert into public.supplier_orders (org_id, supplier_id, expected_at, note)
  values (p_org, p_supplier, p_expected_at, nullif(btrim(p_note), ''))
  returning id into v_order;
  perform private.supplier_order_fill(p_org, v_order, p_supplier, p_items);

  -- Закрываем отметки «Закончилось на полке» по товарам этого заказа.
  if p_marks is not null and array_length(p_marks, 1) > 0 then
    update public.restock_marks m set ordered_at = now()
    where m.org_id = p_org and m.id = any(p_marks) and m.ordered_at is null;
  end if;
  return v_order;
end;
$$;
revoke all on function public.supplier_order_create(uuid, uuid, date, jsonb, uuid[], text) from public, anon;
grant execute on function public.supplier_order_create(uuid, uuid, date, jsonb, uuid[], text) to authenticated;

-- Состав заказа заменяется целиком: так проще и нельзя получить полузаменённый заказ.
create function public.supplier_order_items_set(p_org uuid, p_order uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_status public.supplier_order_status;
  v_count int;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Нет прав менять состав заказа' using errcode = '42501';
  end if;
  select supplier_id, status into v_supplier, v_status
  from public.supplier_orders where id = p_order and org_id = p_org;
  if v_supplier is null then
    raise exception 'Заказ не найден' using errcode = '22023', hint = 'no_order';
  end if;
  if v_status is distinct from 'created' then
    raise exception 'Состав заказа меняют, пока он не подтверждён' using errcode = '22023', hint = 'order_frozen';
  end if;
  delete from public.supplier_order_items where order_id = p_order and org_id = p_org;
  v_count := private.supplier_order_fill(p_org, p_order, v_supplier, p_items);
  return jsonb_build_object('items', v_count);
end;
$$;
revoke all on function public.supplier_order_items_set(uuid, uuid, jsonb) from public, anon;
grant execute on function public.supplier_order_items_set(uuid, uuid, jsonb) to authenticated;

-- ── Состояние заказа ────────────────────────────────────────────────
-- Владелец и управляющий ведут заказ целиком. ТП может только подтвердить СВОЙ заказ (ПСТ-7): больше
-- ничего ему не разрешено, и подтвердить он может лишь то, что ещё не подтверждено.
create function public.supplier_order_status_set(
  p_org uuid, p_order uuid, p_status public.supplier_order_status,
  p_amount_actual bigint default null, p_expected_at date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_full boolean;
  v_supplier uuid;
  v_status public.supplier_order_status;
begin
  v_full := private.has_role(p_org, array['owner', 'manager']::public.app_role[]);
  select supplier_id, status into v_supplier, v_status
  from public.supplier_orders where id = p_order and org_id = p_org;
  if v_supplier is null then
    raise exception 'Заказ не найден' using errcode = '22023', hint = 'no_order';
  end if;
  if not v_full then
    if not (private.has_role(p_org, array['supplier']::public.app_role[])
            and v_supplier in (select private.my_supplier_ids(p_org))) then
      raise exception 'Нет прав менять заказ' using errcode = '42501';
    end if;
    if p_status is distinct from 'confirmed' then
      raise exception 'Поставщик может только подтвердить заказ' using errcode = '42501';
    end if;
    if p_amount_actual is not null or p_expected_at is not null then
      raise exception 'Поставщик меняет только подтверждение' using errcode = '42501';
    end if;
  end if;
  if p_status = 'received' and p_amount_actual is null then
    raise exception 'При приёмке нужна фактическая сумма' using errcode = '22023', hint = 'need_amount';
  end if;
  if p_status is distinct from 'received' and p_amount_actual is not null then
    raise exception 'Фактическая сумма бывает только у принятого заказа' using errcode = '22023', hint = 'bad_amount';
  end if;

  update public.supplier_orders set
    status = p_status,
    amount_actual = case when p_status = 'received' then p_amount_actual else amount_actual end,
    expected_at = coalesce(p_expected_at, expected_at)
  where id = p_order and org_id = p_org;
  return jsonb_build_object('status', p_status);
end;
$$;
revoke all on function public.supplier_order_status_set(uuid, uuid, public.supplier_order_status, bigint, date) from public, anon;
grant execute on function public.supplier_order_status_set(uuid, uuid, public.supplier_order_status, bigint, date) to authenticated;

create function public.supplier_order_note_set(p_org uuid, p_order uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Нет прав менять заказ' using errcode = '42501';
  end if;
  update public.supplier_orders set note = nullif(btrim(p_note), '')
  where id = p_order and org_id = p_org;
  if not found then
    raise exception 'Заказ не найден' using errcode = '22023', hint = 'no_order';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.supplier_order_note_set(uuid, uuid, text) from public, anon;
grant execute on function public.supplier_order_note_set(uuid, uuid, text) to authenticated;

-- ── Чтение ───────────────────────────────────────────────────────────
-- Один список и календарь сразу: заказы за период, суммы по дням и отдельно просроченное
-- (ждали раньше сегодняшнего дня, а поставки так и нет).
-- Сумма заказа НЕ хранится: она всегда считается из состава, иначе разойдётся с ним при первой же правке.
-- Сотруднику зала денег не отдаём вовсе — у него и в каталоге закупочных цен нет.
create function public.supplier_orders_list(
  p_org uuid, p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean;
  v_own boolean := false;
  v_today date := private.org_today(p_org);
  v_from date;
  v_to date;
begin
  v_from := coalesce(p_from, v_today - 30);
  v_to := coalesce(p_to, v_today + 60);
  v_money := private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]);
  if not v_money then
    if private.has_role(p_org, array['staff']::public.app_role[]) then
      v_own := false;
    elsif private.has_role(p_org, array['supplier']::public.app_role[]) then
      v_own := true;
    else
      raise exception 'Нет доступа к заказам' using errcode = '42501';
    end if;
  end if;

  return (
    with visible as (
      select o.*, (select s.name from public.suppliers s where s.id = o.supplier_id) as supplier_name
      from public.supplier_orders o
      where o.org_id = p_org
        and (o.expected_at is null or o.expected_at between v_from and v_to)
        and (not v_own or o.supplier_id in (select private.my_supplier_ids(p_org)))
    ), totals as (
      select i.order_id, count(*) as items,
        (sum(round(i.qty * i.price)) filter (where i.price is not null))::bigint as amount,
        count(*) filter (where i.price is null) as no_price
      from public.supplier_order_items i
      where i.org_id = p_org and i.order_id in (select id from visible)
      group by i.order_id
    ), rows as (
      select v.id, v.supplier_id, v.supplier_name, v.status, v.expected_at, v.created_at,
        coalesce(t.items, 0) as items,
        case when v_money then t.amount end as amount,
        case when v_money then v.amount_actual end as amount_actual,
        coalesce(t.no_price, 0) as no_price,
        v.status in ('created', 'confirmed') and v.expected_at is not null
          and v.expected_at < v_today as overdue
      from visible v left join totals t on t.order_id = v.id
    )
    select jsonb_build_object(
      'money', v_money,
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'supplier_id', r.supplier_id, 'supplier_name', r.supplier_name,
          'status', r.status, 'expected_at', r.expected_at, 'created_at', r.created_at,
          'items', r.items, 'amount', r.amount, 'amount_actual', r.amount_actual,
          'no_price', r.no_price, 'overdue', r.overdue)
        order by r.expected_at nulls last, r.created_at desc) from rows r), '[]'::jsonb),
      'days', coalesce((select jsonb_agg(d) from (
          select jsonb_build_object('date', r.expected_at, 'orders', count(*),
            'amount', case when v_money then sum(r.amount)::bigint end,
            'overdue', bool_or(r.overdue)) as d
          from rows r where r.expected_at is not null and r.status in ('created', 'confirmed')
          group by r.expected_at order by r.expected_at
        ) q), '[]'::jsonb),
      'overdue', (select jsonb_build_object('orders', count(*),
          'amount', case when v_money then sum(r.amount)::bigint end)
        from rows r where r.overdue)
    )
  );
end;
$$;
revoke all on function public.supplier_orders_list(uuid, date, date) from public, anon;
grant execute on function public.supplier_orders_list(uuid, date, date) to authenticated;

-- Один заказ с составом. Сотруднику зала — без цен и сумм.
create function public.supplier_order_get(p_org uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean;
  v_order public.supplier_orders;
  v_who text;
begin
  v_money := private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]);
  select * into v_order from public.supplier_orders where id = p_order and org_id = p_org;
  if v_order.id is null then
    raise exception 'Заказ не найден' using errcode = '22023', hint = 'no_order';
  end if;
  if not v_money then
    if private.has_role(p_org, array['staff']::public.app_role[]) then
      null;
    elsif private.has_role(p_org, array['supplier']::public.app_role[])
      and v_order.supplier_id in (select private.my_supplier_ids(p_org)) then
      null;
    else
      raise exception 'Нет доступа к заказу' using errcode = '42501';
    end if;
  end if;
  -- Кто оформил — только владельцу и управляющему: профили сотрудников закрыты от коллег.
  if private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    select pr.full_name into v_who from public.profiles pr where pr.id = v_order.created_by;
  end if;

  return jsonb_build_object(
    'money', v_money,
    'id', v_order.id,
    'supplier_id', v_order.supplier_id,
    'supplier_name', (select s.name from public.suppliers s where s.id = v_order.supplier_id),
    'status', v_order.status,
    'expected_at', v_order.expected_at,
    'created_at', v_order.created_at,
    'confirmed_at', v_order.confirmed_at,
    'closed_at', v_order.closed_at,
    'note', v_order.note,
    'who', v_who,
    'amount_actual', case when v_money then v_order.amount_actual end,
    'amount', case when v_money then (
      select sum(round(i.qty * i.price))::bigint from public.supplier_order_items i
      where i.order_id = p_order and i.price is not null) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'name', i.name, 'cash_code', i.cash_code,
        'unit', i.unit, 'qty', i.qty,
        'price', case when v_money then i.price end,
        'sum', case when v_money and i.price is not null then round(i.qty * i.price)::bigint end)
      order by i.name) from public.supplier_order_items i
      where i.order_id = p_order and i.org_id = p_org), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.supplier_order_get(uuid, uuid) from public, anon;
grant execute on function public.supplier_order_get(uuid, uuid) to authenticated;
