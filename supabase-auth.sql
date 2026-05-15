-- Аутентификация WORK WATCH (выполнить в Supabase → SQL Editor после supabase-schema.sql)
-- Пароли: bcrypt через pgcrypto. Логин — RPC workwatch_login.

create extension if not exists pgcrypto;

-- Учётные записи: сотрудник (employee_name = ФИО как в табеле) или админ (employee_name null)
create table if not exists public.workwatch_auth_users (
  login text primary key,
  password_hash text not null,
  employee_name text,
  role text not null check (role in ('employee', 'admin')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

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

-- Клиент не читает хеши напрямую; только RPC
create policy "workwatch_auth_users_deny_all"
  on public.workwatch_auth_users for all using (false) with check (false);

create policy "workwatch_login_attempts_deny_all"
  on public.workwatch_login_attempts for all using (false) with check (false);

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
set search_path = public
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
        when failed_attempts + 1 >= 8 then now() + interval '30 minutes'
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
    'expires_at', v_expires
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
grant execute on function public.workwatch_logout(uuid) to anon, authenticated;
grant execute on function public.workwatch_prune_login_attempts() to anon, authenticated;
