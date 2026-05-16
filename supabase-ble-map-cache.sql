-- Кэш списка BLE-меток для карты без прямого доступа к *.workers.dev
-- Выполнить в Supabase → SQL Editor после supabase-schema.sql

create table if not exists public.ble_map_cache (
  company_id int primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ble_map_cache enable row level security;

drop policy if exists "ble_map_cache_anon_read" on public.ble_map_cache;

create policy "ble_map_cache_anon_read"
  on public.ble_map_cache
  for select
  to anon, authenticated
  using (true);

-- Запись только service_role (Edge Function ble-map-sync)
