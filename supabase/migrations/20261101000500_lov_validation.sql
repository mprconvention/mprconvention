-- MPR migration 005: validate LOV-backed codes on insert / when changed.
-- Historical inactive values may remain on records; changing to a new value
-- requires the target value to be active.

create or replace function public.validate_lov_code(
  p_list_code text,
  p_value_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lov_lists l
    join public.lov_values v on v.list_id = l.id
    where l.list_code = p_list_code
      and l.is_active
      and v.value_code = p_value_code
      and v.is_active
  );
$$;

create or replace function public.validate_record_lovs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field text;
  v_list text;
  v_new text;
  v_old text;
begin
  if tg_table_name = 'venues' then
    v_field := 'venue_type_code'; v_list := 'venue_types';
    v_new := new.venue_type_code;
    if tg_op = 'UPDATE' then v_old := old.venue_type_code; end if;
  elsif tg_table_name = 'customers' then
    v_field := 'customer_category_code'; v_list := 'customer_categories';
    v_new := new.customer_category_code;
    if tg_op = 'UPDATE' then v_old := old.customer_category_code; end if;
  elsif tg_table_name = 'calendar_entries' then
    if new.entry_type = 'reserved' then
      v_field := 'event_type_code'; v_list := 'event_types';
      v_new := new.event_type_code;
      if tg_op = 'UPDATE' then v_old := old.event_type_code; end if;
      if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
         and not public.validate_lov_code(v_list, v_new) then
        raise exception 'Invalid or inactive % value: %', v_field, v_new;
      end if;
      v_field := 'booking_source_code'; v_list := 'booking_sources';
      v_new := new.booking_source_code;
      if tg_op = 'UPDATE' then v_old := old.booking_source_code; end if;
      if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
         and not public.validate_lov_code(v_list, v_new) then
        raise exception 'Invalid or inactive % value: %', v_field, v_new;
      end if;
    else
      v_field := 'block_reason_code'; v_list := 'block_reasons';
      v_new := new.block_reason_code;
      if tg_op = 'UPDATE' then v_old := old.block_reason_code; end if;
      if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
         and not public.validate_lov_code(v_list, v_new) then
        raise exception 'Invalid or inactive % value: %', v_field, v_new;
      end if;
    end if;
    return new;
  elsif tg_table_name = 'auspicious_dates' then
    v_field := 'category_code'; v_list := 'auspicious_categories';
    v_new := new.category_code;
    if tg_op = 'UPDATE' then v_old := old.category_code; end if;
    if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
       and not public.validate_lov_code(v_list, v_new) then
      raise exception 'Invalid or inactive % value: %', v_field, v_new;
    end if;

    v_field := 'region_code'; v_list := 'regions';
    v_new := new.region_code;
    if tg_op = 'UPDATE' then v_old := old.region_code; end if;
    if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
       and not public.validate_lov_code(v_list, v_new) then
      raise exception 'Invalid or inactive % value: %', v_field, v_new;
    end if;
    return new;
  end if;

  if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
     and not public.validate_lov_code(v_list, v_new) then
    raise exception 'Invalid or inactive % value: %', v_field, v_new;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_lov_code(text,text) from public;
grant execute on function public.validate_lov_code(text,text) to authenticated;

create trigger venues_validate_lovs
before insert or update of venue_type_code on public.venues
for each row execute function public.validate_record_lovs();

create trigger customers_validate_lovs
before insert or update of customer_category_code on public.customers
for each row execute function public.validate_record_lovs();

create trigger calendar_validate_lovs
before insert or update of event_type_code, booking_source_code, block_reason_code
on public.calendar_entries
for each row execute function public.validate_record_lovs();

create trigger auspicious_validate_lovs
before insert or update of category_code, region_code
on public.auspicious_dates
for each row execute function public.validate_record_lovs();

-- Prevent deactivating a LOV value while it is in active use.
create or replace function public.prevent_used_lov_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_code text;
  v_used boolean := false;
begin
  if old.is_active and not new.is_active then
    select list_code into v_list_code
    from public.lov_lists where id = old.list_id;

    if v_list_code = 'event_types' then
      select exists(select 1 from public.calendar_entries
        where event_type_code = old.value_code and status = 'active') into v_used;
    elsif v_list_code = 'booking_sources' then
      select exists(select 1 from public.calendar_entries
        where booking_source_code = old.value_code and status = 'active') into v_used;
    elsif v_list_code = 'block_reasons' then
      select exists(select 1 from public.calendar_entries
        where block_reason_code = old.value_code and status = 'active') into v_used;
    elsif v_list_code = 'customer_categories' then
      select exists(select 1 from public.customers
        where customer_category_code = old.value_code) into v_used;
    elsif v_list_code = 'venue_types' then
      select exists(select 1 from public.venues
        where venue_type_code = old.value_code) into v_used;
    elsif v_list_code = 'auspicious_categories' then
      select exists(select 1 from public.auspicious_dates
        where category_code = old.value_code and is_active) into v_used;
    elsif v_list_code = 'regions' then
      select exists(select 1 from public.auspicious_dates
        where region_code = old.value_code and is_active) into v_used;
    end if;

    if v_used then
      raise exception 'Cannot deactivate LOV value % while it is in use', old.value_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger lov_value_usage_guard
before update of is_active on public.lov_values
for each row execute function public.prevent_used_lov_deactivation();


-- Stable identifiers must not be changed through normal admin maintenance.
create or replace function public.protect_lov_identifiers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'lov_lists' then
    if tg_op = 'UPDATE' then
      new.list_code := old.list_code;
      new.is_system := old.is_system;
      new.created_at := old.created_at;
      new.updated_at := now();
      return new;
    end if;
    if tg_op = 'DELETE' and old.is_system then
      raise exception 'System LOV lists cannot be deleted';
    end if;
  elsif tg_table_name = 'lov_values' then
    if tg_op = 'UPDATE' then
      new.list_id := old.list_id;
      new.value_code := old.value_code;
      new.created_at := old.created_at;
      new.updated_at := now();
      return new;
    end if;
    if tg_op = 'DELETE' then
      raise exception 'LOV values cannot be hard-deleted; deactivate them instead';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger lov_lists_identifier_guard
before update or delete on public.lov_lists
for each row execute function public.protect_lov_identifiers();

create trigger lov_values_identifier_guard
before update or delete on public.lov_values
for each row execute function public.protect_lov_identifiers();


-- The identifier guard blocks hard deletion. Deactivation is allowed only
-- when the value is not currently referenced by records.


-- Protect privileged profile fields. Direct client-side profile updates cannot
-- assign admin or activate/deactivate accounts. Trusted provisioning RPCs and
-- the initial SQL Editor bootstrap execute with an elevated database role.
create or replace function public.guard_profile_access_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
  ) and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Role and account activation must be changed through trusted admin provisioning';
  end if;
  return new;
end;
$$;

create trigger profile_access_fields_guard
before update of role, is_active on public.profiles
for each row execute function public.guard_profile_access_fields();
