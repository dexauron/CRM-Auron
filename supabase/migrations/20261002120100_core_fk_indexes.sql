-- Индексы для внешних ключей ядра (рекомендация советника Supabase по производительности).
create index consents_user_idx on public.consents (user_id);
create index invites_created_by_idx on public.invites (created_by);
create index invites_used_by_idx on public.invites (used_by);
create index memberships_created_by_idx on public.memberships (created_by);
create index outbox_org_idx on public.outbox (org_id);
