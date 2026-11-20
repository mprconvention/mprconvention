-- Add scheduling presets while retaining the stored calendar modes and
-- exclusion constraint for reservations and blocks.
create or replace function public.mpr_guard_booking_picklist()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  list_code text;
  behavior text := new.extra_data->>'behavior';
begin
  select l.list_code into list_code from public.lov_lists l where l.id = new.list_id;
  if list_code not in ('entry_statuses', 'booking_modes') then return new; end if;

  if behavior is null
     or (list_code = 'entry_statuses' and behavior not in ('pending', 'confirmed', 'blocked'))
     or (list_code = 'booking_modes' and behavior not in (
       'full_day', 'time_slot', 'multiple_days', 'first_half', 'second_half'
     )) then
    raise exception 'Select a booking behavior for this picklist value' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and behavior is distinct from old.extra_data->>'behavior' then
    raise exception 'The behavior of a saved booking option cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

insert into public.lov_values as existing (list_id, value_code, display_label, sort_order, extra_data)
select l.id, seed.code, seed.label, seed.sort_order, jsonb_build_object('behavior', seed.code)
from (values
  ('multiple_days', 'Multiple days', 15),
  ('first_half', 'First half', 30),
  ('second_half', 'Second half', 40)
) as seed(code, label, sort_order)
join public.lov_lists l on l.list_code = 'booking_modes'
on conflict (list_id, value_code) do update set
  extra_data = existing.extra_data || excluded.extra_data
where existing.extra_data->>'behavior' is distinct from excluded.extra_data->>'behavior';

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
  v_schedule text;
  v_status text;
  v_entry_type text;
  v_status_behavior text;
  v_status_code text;
  v_mode_code text;
  v_saved_status text;
  v_saved_mode text;
  v_saved_status_code text;
  v_saved_mode_code text;
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

  v_status_behavior := case when v_entry_type = 'blocked' then 'blocked' else v_status end;

  if p_booking_id is not null then
    select
      case when entry_type = 'blocked' then 'blocked' else booking_status end,
      booking_mode,
      coalesce(entry_status_code, case when entry_type = 'blocked' then 'blocked' else booking_status end),
      coalesce(booking_mode_code, booking_mode)
    into v_saved_status, v_saved_mode, v_saved_status_code, v_saved_mode_code
    from public.calendar_entries
    where id = p_booking_id and status = 'active'
    for update;
    if not found then raise exception 'Active calendar entry not found'; end if;
  end if;

  -- Requests from older clients keep an existing selection if its behavior is unchanged.
  v_status_code := coalesce(nullif(p_payload->>'entry_status_code', ''),
    case when v_status_behavior = v_saved_status then v_saved_status_code end, v_status_behavior);
  v_mode_code := coalesce(nullif(p_payload->>'booking_mode_code', ''),
    case when v_mode = v_saved_mode then v_saved_mode_code end, v_mode);

  perform public.mpr_check_booking_choice('entry_statuses', v_status_code, v_saved_status_code, v_status_behavior);
  select opt.extra_data->>'behavior' into v_schedule
  from public.lov_lists l
  join public.lov_values opt on opt.list_id = l.id
  where l.list_code = 'booking_modes' and opt.value_code = v_mode_code
    and ((l.is_active and opt.is_active) or v_mode_code = v_saved_mode_code)
  for share of l, opt;

  if not found or v_schedule is null or v_mode <> (
    case
      when v_schedule in ('full_day', 'multiple_days') then 'full_day'
      when v_schedule in ('time_slot', 'first_half', 'second_half') then 'time_slot'
      else ''
    end
  ) then
    raise exception 'Select an available booking mode' using errcode = '23514';
  end if;

  -- Use venue-local boundaries for a half-day, independent of client input.
  if v_schedule = 'multiple_days' and v_end_date <= v_start_date then
    raise exception 'Multiple days requires an end date after the start date' using errcode = '23514';
  elsif v_schedule = 'first_half' then
    v_start_time := time '00:00';
    v_end_time := time '12:00';
  elsif v_schedule = 'second_half' then
    v_start_time := time '12:00';
    v_end_time := time '24:00';
  end if;

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
      booking_status, status, block_reason_code, notes, entry_status_code, booking_mode_code,
      created_by, updated_by
    )
    VALUES (
      v_venue_id, v_entry_type, v_mode, v_customer_id,
      v_event_name, v_event_type, v_source,
      v_start_date, v_end_date, v_start_time, v_end_time,
      v_timezone, v_starts_at, v_ends_at,
      v_status, 'active', v_block_reason, v_notes, v_status_code, v_mode_code,
      p_actor_id, p_actor_id
    )
    RETURNING id INTO v_id;

  ELSE
    UPDATE public.calendar_entries
    SET venue_id = v_venue_id,
        entry_type = v_entry_type,
        block_reason_code = v_block_reason,
        booking_mode = v_mode,
        entry_status_code = v_status_code,
        booking_mode_code = v_mode_code,
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
