-- MPR migration 004: service-role-only transactional provisioning RPC.
-- Called only by the admin-invite-user Edge Function after it verifies the caller.

create or replace function public.admin_apply_user_setup(
  p_user_id uuid,
  p_role text,
  p_permissions jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_module text;
  v_action text;
begin
  if p_role not in ('manager','staff','viewer') then
    raise exception 'Invalid assignable role';
  end if;

  if jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'Permissions must be a JSON array';
  end if;

  update public.profiles
  set role = p_role, is_active = true, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found for invited Auth user';
  end if;

  delete from public.user_permissions where user_id = p_user_id;

  for item in select value from jsonb_array_elements(p_permissions)
  loop
    v_module := item->>'module';
    v_action := item->>'action';

    if v_module not in (
      'dashboard','calendar','bookings','calendar_blocks','customers',
      'venues','auspicious_dates','users','reports','lovs'
    ) then
      raise exception 'Invalid permission module: %', v_module;
    end if;

    if v_action not in ('view','create','edit','delete') then
      raise exception 'Invalid permission action: %', v_action;
    end if;

    -- Manager auspicious-date rights are role-derived, not separately assigned.
    if p_role = 'manager' and v_module = 'auspicious_dates' then
      continue;
    end if;

    insert into public.user_permissions(user_id, module, action, granted_by)
    values (p_user_id, v_module, v_action, null)
    on conflict (user_id, module, action) do nothing;
  end loop;
end;
$$;

revoke all on function public.admin_apply_user_setup(uuid,text,jsonb) from public;
revoke all on function public.admin_apply_user_setup(uuid,text,jsonb) from anon;
revoke all on function public.admin_apply_user_setup(uuid,text,jsonb) from authenticated;
grant execute on function public.admin_apply_user_setup(uuid,text,jsonb) to service_role;


-- Admin edit/deactivate existing non-admin users. Service-role only.
create or replace function public.admin_update_user_access(
  p_user_id uuid,
  p_role text,
  p_is_active boolean,
  p_permissions jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_module text;
  v_action text;
  v_existing_role text;
begin
  if p_role not in ('manager','staff','viewer') then
    raise exception 'Invalid assignable role';
  end if;
  if jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'Permissions must be a JSON array';
  end if;

  select role into v_existing_role
  from public.profiles where id = p_user_id
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;
  if v_existing_role = 'admin' then
    raise exception 'Administrator accounts must be managed through a separate break-glass process';
  end if;

  update public.profiles
  set role = p_role, is_active = p_is_active, updated_at = now()
  where id = p_user_id;

  delete from public.user_permissions where user_id = p_user_id;

  for item in select value from jsonb_array_elements(p_permissions)
  loop
    v_module := item->>'module';
    v_action := item->>'action';

    if v_module not in (
      'dashboard','calendar','bookings','calendar_blocks','customers',
      'venues','auspicious_dates','users','reports','lovs'
    ) then
      raise exception 'Invalid permission module: %', v_module;
    end if;
    if v_action not in ('view','create','edit','delete') then
      raise exception 'Invalid permission action: %', v_action;
    end if;
    if p_role = 'manager' and v_module = 'auspicious_dates' then
      continue;
    end if;

    insert into public.user_permissions(user_id, module, action, granted_by)
    values (p_user_id, v_module, v_action, null)
    on conflict (user_id, module, action) do nothing;
  end loop;
end;
$$;

revoke all on function public.admin_update_user_access(uuid,text,boolean,jsonb) from public;
revoke all on function public.admin_update_user_access(uuid,text,boolean,jsonb) from anon;
revoke all on function public.admin_update_user_access(uuid,text,boolean,jsonb) from authenticated;
grant execute on function public.admin_update_user_access(uuid,text,boolean,jsonb) to service_role;
