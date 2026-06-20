-- Служебная учётка для входа на сайт через общий пароль.
-- Выполнить в Supabase SQL Editor после supabase-auth.sql.
-- Логин фиксированный: sitegate
-- Пароль в этом файле не хранится в открытом виде, только bcrypt-хеш.

insert into public.workwatch_auth_users (
  login,
  password_hash,
  employee_name,
  role,
  must_change_password,
  failed_attempts,
  locked_until
)
values (
  'sitegate',
  '$2a$10$.i2ind/RcuueobLc5PL1meZnKcU1kIDqaagPWWzXuzeRT5Gdozk9K',
  'Site Gate',
  'employee',
  false,
  0,
  null
)
on conflict (login) do update set
  password_hash = excluded.password_hash,
  employee_name = excluded.employee_name,
  role = excluded.role,
  must_change_password = false,
  failed_attempts = 0,
  locked_until = null;
