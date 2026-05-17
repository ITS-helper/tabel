-- Аутентификация WORK WATCH (выполнить в Supabase → SQL Editor после supabase-schema.sql)
-- Пароли: bcrypt через pgcrypto. Логин — RPC workwatch_login.

-- В Supabase расширения обычно в схеме extensions (Dashboard → Database → Extensions → pgcrypto).
create extension if not exists pgcrypto with schema extensions;

-- Учётные записи: сотрудник (employee_name = ФИО как в табеле) или админ (employee_name null)
create table if not exists public.workwatch_auth_users (
  login text primary key,
  password_hash text not null,
  employee_name text,
  role text not null check (role in ('employee', 'admin')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.workwatch_auth_users
  add column if not exists must_change_password boolean not null default true;

update public.workwatch_auth_users
set must_change_password = false
where role = 'admin' and must_change_password = true;

create index if not exists workwatch_auth_users_employee_name_idx
  on public.workwatch_auth_users (employee_name)
  where employee_name is not null;

-- Журнал попыток входа (защита от перебора)
create table if not exists public.workwatch_login_attempts (
  id bigserial primary key,
  ip_address text not null,
  login text,
  success boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists workwatch_login_attempts_ip_created_idx
  on public.workwatch_login_attempts (ip_address, created_at desc);

-- Сессии (токен возвращается клиенту после успешного входа)
create table if not exists public.workwatch_sessions (
  token uuid primary key default gen_random_uuid(),
  login text not null references public.workwatch_auth_users (login) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists workwatch_sessions_expires_idx
  on public.workwatch_sessions (expires_at);

alter table public.workwatch_auth_users enable row level security;
alter table public.workwatch_login_attempts enable row level security;
alter table public.workwatch_sessions enable row level security;

-- Клиент не читает хеши напрямую; только RPC (повторный запуск файла — безопасен)
drop policy if exists "workwatch_auth_users_deny_all" on public.workwatch_auth_users;
create policy "workwatch_auth_users_deny_all"
  on public.workwatch_auth_users for all using (false) with check (false);

drop policy if exists "workwatch_login_attempts_deny_all" on public.workwatch_login_attempts;
create policy "workwatch_login_attempts_deny_all"
  on public.workwatch_login_attempts for all using (false) with check (false);

drop policy if exists "workwatch_sessions_deny_all" on public.workwatch_sessions;
create policy "workwatch_sessions_deny_all"
  on public.workwatch_sessions for all using (false) with check (false);

-- Очистка старых попыток (можно вызывать по cron)
create or replace function public.workwatch_prune_login_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.workwatch_login_attempts
  where created_at < now() - interval '7 days';
  delete from public.workwatch_sessions where expires_at < now();
$$;

-- Вход: лимит по IP и по учётке, блокировка после серии ошибок
create or replace function public.workwatch_login(
  p_login text,
  p_password text,
  p_ip text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login text;
  v_ip text;
  v_user public.workwatch_auth_users%rowtype;
  v_ip_fails int;
  v_token uuid;
  v_expires timestamptz;
begin
  v_login := lower(trim(coalesce(p_login, '')));
  v_ip := left(trim(coalesce(p_ip, 'unknown')), 64);

  if length(v_login) < 2 or length(coalesce(p_password, '')) < 4 then
    insert into public.workwatch_login_attempts (ip_address, login, success)
    values (v_ip, v_login, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  select count(*)::int into v_ip_fails
  from public.workwatch_login_attempts
  where ip_address = v_ip
    and success = false
    and created_at > now() - interval '15 minutes';

  if v_ip_fails >= 25 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after_sec', 900);
  end if;

  select * into v_user from public.workwatch_auth_users where login = v_login;

  if not found then
    insert into public.workwatch_login_attempts (ip_address, login, success)
    values (v_ip, v_login, false);
    perform pg_sleep(0.35);
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if v_user.locked_until is not null and v_user.locked_until > now() then
    insert into public.workwatch_login_attempts (ip_address, login, success)
    values (v_ip, v_login, false);
    return jsonb_build_object(
      'ok', false,
      'error', 'account_locked',
      'locked_until', v_user.locked_until
    );
  end if;

  if v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    update public.workwatch_auth_users
    set
      failed_attempts = failed_attempts + 1,
      locked_until = case
        when failed_attempts + 1 >= 20 then now() + interval '30 minutes'
        else locked_until
      end
    where login = v_login;

    insert into public.workwatch_login_attempts (ip_address, login, success)
    values (v_ip, v_login, false);
    perform pg_sleep(0.35);
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  update public.workwatch_auth_users
  set failed_attempts = 0, locked_until = null
  where login = v_login;

  v_expires := now() + interval '12 hours';
  insert into public.workwatch_sessions (login, expires_at)
  values (v_login, v_expires)
  returning token into v_token;

  insert into public.workwatch_login_attempts (ip_address, login, success)
  values (v_ip, v_login, true);

  return jsonb_build_object(
    'ok', true,
    'token', v_token::text,
    'login', v_user.login,
    'role', v_user.role,
    'employee_name', v_user.employee_name,
    'expires_at', v_expires,
    'must_change_password', coalesce(v_user.must_change_password, false)
  );
end;
$$;

-- Смена пароля (нужна активная сессия и текущий пароль)
create or replace function public.workwatch_change_password(
  p_token uuid,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login text;
  v_user public.workwatch_auth_users%rowtype;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select s.login into v_login
  from public.workwatch_sessions s
  where s.token = p_token and s.expires_at > now();

  if v_login is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into v_user from public.workwatch_auth_users where login = v_login;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if length(coalesce(p_current_password, '')) < 4 or length(coalesce(p_new_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'password_too_short');
  end if;

  if p_new_password = p_current_password then
    return jsonb_build_object('ok', false, 'error', 'password_same');
  end if;

  if p_new_password = '12345678' then
    return jsonb_build_object('ok', false, 'error', 'password_too_weak');
  end if;

  if v_user.password_hash <> crypt(p_current_password, v_user.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'invalid_current_password');
  end if;

  update public.workwatch_auth_users
  set
    password_hash = crypt(p_new_password, gen_salt('bf', 10)),
    must_change_password = false,
    failed_attempts = 0,
    locked_until = null
  where login = v_login;

  return jsonb_build_object('ok', true, 'must_change_password', false);
end;
$$;

-- Админ: сброс пароля сотрудника и привязка логина к текущему ТН (создаёт учётку, если нет)
create or replace function public.workwatch_admin_reset_employee_auth(
  p_token uuid,
  p_employee_name text,
  p_login text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin_login text;
  v_admin_role text;
  v_login text;
  v_name text;
  v_old_login text;
  v_default_pw text := '12345678';
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select s.login into v_admin_login
  from public.workwatch_sessions s
  where s.token = p_token and s.expires_at > now();

  if v_admin_login is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select role into v_admin_role from public.workwatch_auth_users where login = v_admin_login;
  if v_admin_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_name := trim(coalesce(p_employee_name, ''));
  v_login := lower(trim(coalesce(p_login, '')));

  if length(v_name) < 3 or length(v_login) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select login into v_old_login
  from public.workwatch_auth_users
  where employee_name = v_name and role = 'employee'
  limit 1;

  if v_old_login is not null and v_old_login <> v_login then
    delete from public.workwatch_sessions where login = v_old_login;
    delete from public.workwatch_auth_users where login = v_old_login;
  end if;

  insert into public.workwatch_auth_users (
    login, password_hash, employee_name, role, must_change_password, failed_attempts, locked_until
  )
  values (
    v_login,
    crypt(v_default_pw, gen_salt('bf', 10)),
    v_name,
    'employee',
    true,
    0,
    null
  )
  on conflict (login) do update set
    password_hash = excluded.password_hash,
    employee_name = excluded.employee_name,
    role = 'employee',
    must_change_password = true,
    failed_attempts = 0,
    locked_until = null;

  delete from public.workwatch_sessions
  where login = v_login and token <> p_token;

  return jsonb_build_object(
    'ok', true,
    'login', v_login,
    'employee_name', v_name,
    'default_password', v_default_pw
  );
end;
$$;

create or replace function public.workwatch_logout(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.workwatch_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.workwatch_login(text, text, text) to anon, authenticated;
grant execute on function public.workwatch_change_password(uuid, text, text) to anon, authenticated;
grant execute on function public.workwatch_admin_reset_employee_auth(uuid, text, text) to anon, authenticated;
grant execute on function public.workwatch_logout(uuid) to anon, authenticated;
grant execute on function public.workwatch_prune_login_attempts() to anon, authenticated;
