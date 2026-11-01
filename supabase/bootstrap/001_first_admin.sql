-- Run ONCE in Supabase SQL Editor after migrations 001-005.
-- Replace all values. Use a unique temporary password (16+ characters), then change it immediately.
-- Login accepts either username or email.
begin;
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_username text := lower('mpradmin');
  v_email text := lower('admin@example.com');
  v_full_name text := 'MPR Administrator';
  v_temporary_password text := 'REPLACE-WITH-A-UNIQUE-16-PLUS-CHARACTER-TEMP-PASSWORD';
  v_module text;
  v_action text;
begin
  if v_temporary_password like 'REPLACE-%' or length(v_temporary_password) < 16 then
    raise exception 'Set a unique temporary password of at least 16 characters before running this script';
  end if;
  if exists (select 1 from public.mpr_users where lower(username)=lower(v_username) or lower(email)=lower(v_email)) then
    raise exception 'Username or email already exists';
  end if;
  insert into public.mpr_users(id, username, email, full_name, password_hash, role, is_active, must_change_password)
  values (v_user_id, v_username, v_email, v_full_name,
          extensions.crypt(v_temporary_password, extensions.gen_salt('bf', 12)), 'admin', true, true);
  foreach v_module in array array['dashboard','calendar','bookings','calendar_blocks','customers','venues','auspicious_dates','users','reports','lovs'] loop
    foreach v_action in array array['view','create','edit','delete'] loop
      insert into public.user_permissions(user_id,module,action,granted_by)
      values (v_user_id,v_module,v_action,v_user_id) on conflict (user_id,module,action) do nothing;
    end loop;
  end loop;
  raise notice 'MPR administrator created. User ID: %; username: %', v_user_id, v_username;
end $$;
commit;
