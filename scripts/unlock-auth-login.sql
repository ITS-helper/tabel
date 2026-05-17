-- Разблокировать учётку и сбросить счётчик ошибок (выполнить в Supabase SQL Editor).
-- Замените 'admin' на нужный login.
update public.workwatch_auth_users
set failed_attempts = 0, locked_until = null
where login = 'admin';
