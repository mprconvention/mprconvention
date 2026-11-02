-- MPR migration 002: security helpers, timestamp derivation, audit, profile trigger.

create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin' and p.is_active
  );
$$;

create or replace function public.has_permission(p_module text, p_action text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.profiles p
      join public.user_permissions up on up.user_id = p.id
      where p.id = (select auth.uid())
        and p.is_active
        and up.module = p_module
        and up.action = p_action
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active and p.role = 'manager'
        and p_module = 'auspicious_dates'
        and p_action in ('view','create','edit','delete')
    );
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.has_permission(text,text) from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_permission(text,text) to authenticated;

-- Profile creation after Supabase Auth signup/invitation.
-- Never trust role from user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'New User'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Set venue timezone and calculate absolute occupancy timestamps.
create or replace function public.prepare_calendar_entry()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_active boolean;
begin
  select timezone, is_active into v_timezone, v_active
  from public.venues where id = new.venue_id;

  if not found or not v_active then
    raise exception 'Venue does not exist or is inactive';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;

  new.timezone := v_timezone;

  if new.booking_mode = 'full_day' then
    new.starts_at := (new.start_date::timestamp at time zone v_timezone);
    new.ends_at := ((new.end_date + 1)::timestamp at time zone v_timezone);
  else
    new.starts_at := ((new.start_date + new.start_time) at time zone v_timezone);
    new.ends_at := ((new.end_date + new.end_time) at time zone v_timezone);
  end if;

  return new;
end;
$$;

create trigger calendar_entry_prepare
before insert or update on public.calendar_entries
for each row execute function public.prepare_calendar_entry();

create or replace function public.prepare_owned_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if tg_table_name = 'customers' then
      new.updated_by := auth.uid();
    elsif tg_table_name = 'auspicious_dates' then
      new.updated_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger customers_prepare
before insert or update on public.customers
for each row execute function public.prepare_owned_record();

create trigger auspicious_prepare
before insert or update on public.auspicious_dates
for each row execute function public.prepare_owned_record();

create or replace function public.prepare_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_prepare
before update on public.profiles
for each row execute function public.prepare_profile_update();

create or replace function public.prepare_lov_value()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger lov_values_prepare
before insert or update on public.lov_values
for each row execute function public.prepare_lov_value();

create or replace function public.prepare_lov_list()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lov_lists_prepare
before update on public.lov_lists
for each row execute function public.prepare_lov_list();

-- Audit trigger. Audit table is not directly writable by authenticated users.
create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_id := v_new->>'id';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := v_new->>'id';
  else
    v_old := to_jsonb(old);
    v_id := v_old->>'id';
  end if;

  insert into public.audit_logs(user_id, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, v_id, tg_op, v_old, v_new);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_customers after insert or update or delete on public.customers
for each row execute function public.write_audit_log();
create trigger audit_calendar after insert or update or delete on public.calendar_entries
for each row execute function public.write_audit_log();
create trigger audit_auspicious after insert or update or delete on public.auspicious_dates
for each row execute function public.write_audit_log();
create trigger audit_profiles after update or delete on public.profiles
for each row execute function public.write_audit_log();
create trigger audit_permissions after insert or update or delete on public.user_permissions
for each row execute function public.write_audit_log();
create trigger audit_venues after insert or update or delete on public.venues
for each row execute function public.write_audit_log();
create trigger audit_lov_values after insert or update or delete on public.lov_values
for each row execute function public.write_audit_log();
create trigger audit_lov_lists after insert or update or delete on public.lov_lists
for each row execute function public.write_audit_log();
