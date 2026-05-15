-- Выполнить один раз в Supabase → SQL Editor
-- Таблица общего состояния табеля (одна строка id = global)

create table if not exists public.tabel_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tabel_state enable row level security;

drop policy if exists "tabel_state_anon_rw" on public.tabel_state;

create policy "tabel_state_anon_rw"
  on public.tabel_state
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Аутентификация (логин сотрудников и админа): см. supabase-auth.sql
