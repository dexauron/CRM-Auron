-- Второй фактор (ТЗ, этап 0; docs/SECURITY.md). Права владельца, управляющего и бухгалтера действуют только
-- в сессии, подтверждённой кодом из приложения-аутентификатора (уровень aal2 в токене). Без кода такой человек
-- остаётся участником магазина, но без привилегий. Сотрудник, поставщик и покупатель кода не вводят.

create or replace function private.has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
      and (
        m.role not in ('owner', 'manager', 'accountant')
        or coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      )
  );
$$;

-- Профили людей магазина видят владелец, управляющий и бухгалтер — тоже только со вторым фактором.
create or replace function private.can_view_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid()) or (
    coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1
      from public.memberships viewer
      join public.memberships target on target.org_id = viewer.org_id
      where viewer.user_id = (select auth.uid())
        and viewer.status = 'active'
        and viewer.role in ('owner', 'manager', 'accountant')
        and target.user_id = p_user
        and (target.role <> 'customer' or viewer.role = 'owner')
    )
  );
$$;
