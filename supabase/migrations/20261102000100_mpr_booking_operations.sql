
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
  v_status := COALESCE(p_payload->>'booking_status','pending');
  v_event_name := NULLIF(trim(p_payload->>'event_name'),'');
  v_event_type := NULLIF(p_payload->>'event_type_code','');
  v_source := NULLIF(p_payload->>'booking_source_code','');
  v_start_date := NULLIF(p_payload->>'start_date','')::date;
  v_end_date := NULLIF(p_payload->>'end_date','')::date;
  v_start_time := NULLIF(p_payload->>'start_time','')::time;
  v_end_time := NULLIF(p_payload->>'end_time','')::time;
  v_notes := NULLIF(p_payload->>'notes','');

  IF v_venue_id IS NULL OR v_customer_id IS NULL
     OR v_start_date IS NULL OR v_end_date IS NULL
     OR v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Required booking details are missing or invalid';
  END IF;

  IF v_mode NOT IN ('full_day','time_slot') THEN
    RAISE EXCEPTION 'Invalid booking mode';
  END IF;

  IF v_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'Invalid booking status';
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

  IF NOT EXISTS (
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
      booking_status, status, notes,
      created_by, updated_by
    )
    VALUES (
      v_venue_id, 'reserved', v_mode, v_customer_id,
      v_event_name, v_event_type, v_source,
      v_start_date, v_end_date, v_start_time, v_end_time,
      v_timezone, v_starts_at, v_ends_at,
      v_status, 'active', v_notes,
      p_actor_id, p_actor_id
    )
    RETURNING id INTO v_id;

  ELSE
    UPDATE public.calendar_entries
    SET venue_id = v_venue_id,
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
      AND entry_type = 'reserved'
      AND status = 'active'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Active booking not found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mpr_save_booking(uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mpr_save_booking(uuid, uuid, jsonb)
TO service_role;
