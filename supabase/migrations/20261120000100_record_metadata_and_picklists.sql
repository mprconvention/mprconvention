-- Add row metadata without overwriting existing creator or modification dates.
do $$
declare
  t text;
begin
  foreach t in array array['profiles','venues','customers','calendar_entries',
    'auspicious_dates','lov_lists','lov_values','user_permissions','audit_logs',
    'mpr_users','mpr_sessions'] loop
    execute format('alter table public.%I
      add column if not exists created_by uuid references public.mpr_users(id),
      add column if not exists updated_by uuid references public.mpr_users(id),
      add column if not exists updated_at timestamptz', t);
  end loop;
end;
$$;

-- Only recover actors and timestamps supported by existing data.
-- The permission backfill does not represent a new grant or user action.
alter table public.user_permissions disable trigger audit_permissions;
update public.user_permissions
set created_by = granted_by, updated_by = granted_by, updated_at = created_at;
alter table public.user_permissions enable trigger audit_permissions;
update public.mpr_sessions
set created_by = user_id, updated_by = user_id, updated_at = last_seen_at;
update public.audit_logs
set created_by = user_id, updated_by = user_id, updated_at = created_at;

create function public.mpr_stamp_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := statement_timestamp();
  else
    if tg_table_name = 'user_permissions' then
      new.created_by := coalesce(new.created_by, new.granted_by);
    elsif tg_table_name in ('audit_logs', 'mpr_sessions') then
      new.created_by := coalesce(new.created_by, new.user_id);
    end if;
    new.updated_by := coalesce(new.updated_by, new.created_by);
  end if;
  return new;
end;
$$;
revoke all on function public.mpr_stamp_record() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['profiles','venues','customers','calendar_entries',
    'auspicious_dates','lov_lists','lov_values','user_permissions','audit_logs',
    'mpr_users','mpr_sessions'] loop
    execute format('alter table public.%I alter column updated_at set default now(),
      alter column updated_at set not null', t);
    execute format('create trigger zz_mpr_stamp before insert or update on public.%I
      for each row execute function public.mpr_stamp_record()', t);
  end loop;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  actor uuid;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;

  if tg_op = 'DELETE' then
    actor := nullif(current_setting('mpr.actor_id', true), '')::uuid;
  elsif tg_op = 'INSERT' then
    actor := (after_row->>'created_by')::uuid;
  else
    actor := (after_row->>'updated_by')::uuid;
  end if;

  -- Account audit records must never include credential hashes.
  before_row := before_row - 'password_hash';
  after_row := after_row - 'password_hash';

  insert into public.audit_logs(user_id, table_name, record_id, action, old_data, new_data)
  values (actor, tg_table_name, coalesce(after_row->>'id', before_row->>'id'),
    tg_op, before_row, after_row);
  return null;
end;
$$;

create trigger audit_mpr_users
after insert or delete or update of username, email, full_name, phone, role,
  is_active, must_change_password, password_hash on public.mpr_users
for each row execute function public.write_audit_log();

-- Give hard deletes the authenticated actor in the same transaction.
create function public.mpr_delete_customer(p_id uuid, p_actor_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('mpr.actor_id', p_actor_id::text, true);
  delete from public.customers where id = p_id;
end;
$$;
revoke all on function public.mpr_delete_customer(uuid,uuid) from public, anon, authenticated;
grant execute on function public.mpr_delete_customer(uuid,uuid) to service_role;

-- Register additional text columns by attaching the same trigger with pairs of
-- column name and list code. Existing values remain valid until changed.
create function public.mpr_validate_picklists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row jsonb := to_jsonb(new);
  previous_row jsonb;
  i integer := 0;
  field_name text;
  value_code text;
begin
  if tg_op = 'UPDATE' then previous_row := to_jsonb(old); end if;
  while i < tg_nargs loop
    field_name := tg_argv[i];
    value_code := current_row->>field_name;
    if not current_row ? field_name or i + 1 >= tg_nargs then
      raise exception 'Invalid picklist binding for %.%', tg_table_name, field_name;
    end if;
    if value_code is not null and value_code is distinct from previous_row->>field_name then
      -- Row locks serialize selection of a value with changes to its active state.
      perform 1 from public.lov_lists l
      join public.lov_values v on v.list_id = l.id
      where l.list_code = tg_argv[i + 1] and l.is_active
        and v.value_code = value_code and v.is_active
      for share of l, v;
      if not found then
        raise exception 'Invalid or inactive % value: %', field_name, value_code
          using errcode = '23514';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;
revoke all on function public.mpr_validate_picklists() from public, anon, authenticated;

drop trigger if exists venues_validate_lovs on public.venues;
drop trigger if exists customers_validate_lovs on public.customers;
drop trigger if exists calendar_validate_lovs on public.calendar_entries;
drop trigger if exists auspicious_validate_lovs on public.auspicious_dates;

create trigger venues_validate_lovs before insert or update on public.venues
for each row execute function public.mpr_validate_picklists('venue_type_code','venue_types');
create trigger customers_validate_lovs before insert or update on public.customers
for each row execute function public.mpr_validate_picklists('customer_category_code','customer_categories');
create trigger calendar_validate_lovs before insert or update on public.calendar_entries
for each row execute function public.mpr_validate_picklists(
  'event_type_code','event_types','booking_source_code','booking_sources','block_reason_code','block_reasons');
create trigger auspicious_validate_lovs before insert or update on public.auspicious_dates
for each row execute function public.mpr_validate_picklists(
  'category_code','auspicious_categories','region_code','regions');

-- Preserve the booking RPC contract and support configured block reasons.

CREATE OR REPLACE FUNCTION public.mpr_save_booking(
  p_actor_id uuid,
  p_booking_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_venue_id uuid;
  v_customer_id uuid;
  v_timezone text;
  v_mode text;
  v_status text;
  v_entry_type text;
  v_block_reason text;
  v_event_name text;
  v_event_type text;
  v_source text;
  v_start_date date;
  v_end_date date;
  v_start_time time;
  v_end_time time;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_notes text;
BEGIN
  IF p_actor_id IS NULL OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid booking request';
  END IF;

  v_venue_id := NULLIF(p_payload->>'venue_id','')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id','')::uuid;
  v_mode := p_payload->>'booking_mode';
  v_entry_type := COALESCE(p_payload->>'entry_type','reserved');
  v_block_reason := NULLIF(trim(p_payload->>'block_reason_code'),'');
  v_status := CASE WHEN v_entry_type = 'reserved' THEN COALESCE(p_payload->>'booking_status','pending') END;
  v_event_name := NULLIF(trim(p_payload->>'event_name'),'');
  v_event_type := NULLIF(p_payload->>'event_type_code','');
  v_source := NULLIF(p_payload->>'booking_source_code','');
  v_start_date := NULLIF(p_payload->>'start_date','')::date;
  v_end_date := NULLIF(p_payload->>'end_date','')::date;
  v_start_time := NULLIF(p_payload->>'start_time','')::time;
  v_end_time := NULLIF(p_payload->>'end_time','')::time;
  v_notes := NULLIF(p_payload->>'notes','');

  IF v_venue_id IS NULL
     OR v_start_date IS NULL OR v_end_date IS NULL
     OR v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Required booking details are missing or invalid';
  END IF;

  IF v_mode IS NULL OR v_mode NOT IN ('full_day','time_slot') THEN
    RAISE EXCEPTION 'Invalid booking mode';
  END IF;

  IF v_entry_type = 'reserved' THEN
    IF v_customer_id IS NULL OR v_status NOT IN ('pending','confirmed') THEN
      RAISE EXCEPTION 'Reservations require a customer and valid booking status';
    END IF;
    v_block_reason := NULL;
  ELSIF v_entry_type = 'blocked' THEN
    IF v_block_reason IS NULL OR v_customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'Blocked periods require a block reason and no customer';
    END IF;
    v_event_type := NULL;
    v_source := NULL;
  ELSE
    RAISE EXCEPTION 'Invalid calendar entry type';
  END IF;

  IF v_end_date < v_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF v_mode = 'full_day' THEN
    IF v_start_time IS NOT NULL OR v_end_time IS NOT NULL THEN
      RAISE EXCEPTION 'Full-day bookings must not contain times';
    END IF;

  ELSIF v_mode = 'time_slot' THEN
    IF v_start_date <> v_end_date
       OR v_start_time IS NULL OR v_end_time IS NULL
       OR v_end_time <= v_start_time THEN
      RAISE EXCEPTION 'Invalid time-slot booking';
    END IF;
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.venues
  WHERE id = v_venue_id AND is_active = true;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'Venue does not exist or is inactive';
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = v_customer_id
  ) THEN
    RAISE EXCEPTION 'Customer does not exist';
  END IF;

  IF v_mode = 'full_day' THEN
    v_starts_at := v_start_date::timestamp AT TIME ZONE v_timezone;
    v_ends_at := (v_end_date + 1)::timestamp AT TIME ZONE v_timezone;
  ELSE
    v_starts_at := (v_start_date + v_start_time) AT TIME ZONE v_timezone;
    v_ends_at := (v_start_date + v_end_time) AT TIME ZONE v_timezone;
  END IF;

  IF p_booking_id IS NULL THEN
    INSERT INTO public.calendar_entries (
      venue_id, entry_type, booking_mode, customer_id,
      event_name, event_type_code, booking_source_code,
      start_date, end_date, start_time, end_time,
      timezone, starts_at, ends_at,
      booking_status, status, block_reason_code, notes,
      created_by, updated_by
    )
    VALUES (
      v_venue_id, v_entry_type, v_mode, v_customer_id,
      v_event_name, v_event_type, v_source,
      v_start_date, v_end_date, v_start_time, v_end_time,
      v_timezone, v_starts_at, v_ends_at,
      v_status, 'active', v_block_reason, v_notes,
      p_actor_id, p_actor_id
    )
    RETURNING id INTO v_id;

  ELSE
    UPDATE public.calendar_entries
    SET venue_id = v_venue_id,
        entry_type = v_entry_type,
        block_reason_code = v_block_reason,
        booking_mode = v_mode,
        customer_id = v_customer_id,
        event_name = v_event_name,
        event_type_code = v_event_type,
        booking_source_code = v_source,
        start_date = v_start_date,
        end_date = v_end_date,
        start_time = v_start_time,
        end_time = v_end_time,
        timezone = v_timezone,
        starts_at = v_starts_at,
        ends_at = v_ends_at,
        booking_status = v_status,
        notes = v_notes,
        updated_by = p_actor_id,
        updated_at = now()
    WHERE id = p_booking_id
      AND status = 'active'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Active calendar entry not found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mpr_save_booking(uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mpr_save_booking(uuid, uuid, jsonb)
TO service_role;
