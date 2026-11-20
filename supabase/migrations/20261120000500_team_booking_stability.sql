-- Keep booking metadata and occupancy separate. The existing editor still
-- supplies one contiguous allocation per calendar entry.
alter table public.calendar_entries
  add column revision bigint not null default 1,
  add column hold_expires_at timestamptz,
  add constraint calendar_hold_pending check (hold_expires_at is null or booking_status is not distinct from 'pending');

create table public.booking_allocations (
  calendar_entry_id uuid primary key references public.calendar_entries(id) on delete cascade,
  venue_id uuid not null references public.venues(id),
  occupied_range tstzrange not null,
  constraint booking_allocations_no_overlap exclude using gist (venue_id with =, occupied_range with &&)
);
alter table public.booking_allocations enable row level security;
revoke all on public.booking_allocations from public, anon, authenticated, service_role;

insert into public.booking_allocations (calendar_entry_id, venue_id, occupied_range)
select id, venue_id, occupied_range from public.calendar_entries where status = 'active';
alter table public.calendar_entries drop constraint prevent_venue_overlap;

create function public.mpr_sync_booking_allocation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.booking_allocations where calendar_entry_id = new.id;
  else
    insert into public.booking_allocations (calendar_entry_id, venue_id, occupied_range)
    values (new.id, new.venue_id, new.occupied_range)
    on conflict (calendar_entry_id) do update
      set venue_id = excluded.venue_id, occupied_range = excluded.occupied_range
    where (booking_allocations.venue_id, booking_allocations.occupied_range)
      is distinct from (excluded.venue_id, excluded.occupied_range);
  end if;
  return null;
end;
$$;
create trigger mpr_sync_booking_allocation
after insert or update of status, venue_id, starts_at, ends_at on public.calendar_entries
for each row execute function public.mpr_sync_booking_allocation();

create function public.mpr_booking_revision()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger mpr_booking_revision before update on public.calendar_entries
for each row execute function public.mpr_booking_revision();

create index calendar_entries_expiring_holds_idx
  on public.calendar_entries (venue_id, hold_expires_at)
  where status = 'active' and hold_expires_at is not null;
create index calendar_entries_paging_idx on public.calendar_entries (starts_at desc, id desc);

create function public.mpr_user_can(p_actor uuid, p_module text, p_action text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.mpr_users u
    where u.id = p_actor and u.is_active and not u.must_change_password
      and (
        u.role = 'admin'
        or (p_module not in ('users', 'lovs') and (u.role <> 'viewer' or p_action = 'view') and (
          (u.role = 'manager' and p_module = 'auspicious_dates')
          or exists (select 1 from public.user_permissions p
            where p.user_id = u.id and p.module = p_module and p.action = p_action)
        ))
      )
  )
$$;

create function public.mpr_manage_user(p_actor uuid, p_target uuid, p_changes jsonb)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  target public.mpr_users%rowtype;
  permissions jsonb := p_changes->'permissions';
  new_role text := p_changes->>'role';
begin
  perform 1 from public.mpr_users
    where id = p_actor and role = 'admin' and is_active and not must_change_password for share;
  if not found then raise insufficient_privilege using message = 'Administrator access required'; end if;

  if jsonb_typeof(p_changes) is distinct from 'object'
    or (p_changes ? 'role' and (new_role is null or new_role not in ('manager','staff','viewer')))
    or (p_changes ? 'is_active' and jsonb_typeof(p_changes->'is_active') <> 'boolean')
    or (permissions is not null and jsonb_typeof(permissions) <> 'array') then
    raise exception 'Invalid user access settings' using errcode = '22023';
  end if;

  if p_target is null then
    insert into public.mpr_users (username, email, full_name, role, password_hash, must_change_password, created_by)
    values (p_changes->>'username', p_changes->>'email', p_changes->>'full_name',
      coalesce(new_role, 'staff'), p_changes->>'password_hash', true, p_actor)
    returning * into target;
  else
    select * into target from public.mpr_users where id = p_target for update;
    if not found then raise no_data_found using message = 'User not found'; end if;
    if target.role = 'admin' then
      raise insufficient_privilege using message = 'Administrator accounts require a controlled SQL procedure';
    end if;
    update public.mpr_users
    set role = coalesce(new_role, role),
        is_active = coalesce((p_changes->>'is_active')::boolean, is_active),
        updated_by = p_actor
    where id = p_target returning * into target;
  end if;

  if permissions is not null then
    perform set_config('mpr.actor_id', p_actor::text, true);
    delete from public.user_permissions where user_id = target.id;
    insert into public.user_permissions (user_id, module, action, granted_by)
    select distinct target.id, permission.module, permission.action, p_actor
    from jsonb_to_recordset(permissions) as permission(module text, action text);
  end if;
  if p_target is not null then
    delete from public.mpr_sessions where user_id = target.id;
  end if;
  return jsonb_build_object('id',target.id,'username',target.username,'email',target.email,
    'full_name',target.full_name,'role',target.role,'is_active',target.is_active);
end;
$$;

create function public.mpr_cancel_booking(p_actor uuid, p_id uuid, p_revision bigint)
returns void language plpgsql set search_path = ''
as $$
declare
  entry public.calendar_entries%rowtype;
begin
  perform 1 from public.mpr_users where id = p_actor for share;
  select * into entry from public.calendar_entries where id = p_id for update;
  if not found then raise no_data_found using message = 'Calendar entry not found'; end if;
  if not public.mpr_user_can(p_actor, case when entry.entry_type = 'blocked' then 'calendar_blocks' else 'bookings' end, 'delete') then
    raise insufficient_privilege using message = 'Booking cancellation permission required';
  end if;
  if entry.status <> 'active' or entry.revision is distinct from p_revision
    or entry.hold_expires_at <= clock_timestamp() then
    raise exception 'This entry changed or expired. Refresh and reopen it.' using errcode = 'P4090';
  end if;
  update public.calendar_entries set status = 'cancelled', hold_expires_at = null, updated_by = p_actor where id = p_id;
end;
$$;

create function public.mpr_issue_session(p_actor uuid, p_expected_hash text, p_token_hash text, p_expires timestamptz)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  account public.mpr_users%rowtype;
begin
  select * into account from public.mpr_users where id = p_actor for update;
  if not found or not account.is_active or account.password_hash is distinct from p_expected_hash then
    raise insufficient_privilege using message = 'Invalid login or password';
  end if;
  insert into public.mpr_sessions (user_id, token_hash, expires_at) values (p_actor, p_token_hash, p_expires);
  update public.mpr_users set last_login_at = statement_timestamp(), updated_by = p_actor where id = p_actor;
  return jsonb_build_object(
    'user', jsonb_build_object('id', account.id, 'username', account.username, 'email', account.email,
      'full_name', account.full_name, 'role', account.role, 'is_active', account.is_active,
      'must_change_password', account.must_change_password),
    'permissions', (select coalesce(jsonb_agg(jsonb_build_object('module', module, 'action', action)), '[]'::jsonb)
      from public.user_permissions where user_id = p_actor)
  );
end;
$$;

create function public.mpr_replace_password(p_actor uuid, p_session uuid, p_expected_hash text, p_new_hash text)
returns void language plpgsql set search_path = ''
as $$
declare
  account public.mpr_users%rowtype;
begin
  select * into account from public.mpr_users where id = p_actor for update;
  if not found or not account.is_active or account.password_hash is distinct from p_expected_hash
    or not exists (select 1 from public.mpr_sessions
      where id = p_session and user_id = p_actor and expires_at > clock_timestamp()) then
    raise insufficient_privilege using message = 'Your session or password changed. Sign in again.';
  end if;
  update public.mpr_users set password_hash = p_new_hash, must_change_password = false, updated_by = p_actor where id = p_actor;
  delete from public.mpr_sessions where user_id = p_actor;
end;
$$;

revoke all on function public.mpr_sync_booking_allocation(), public.mpr_booking_revision(),
  public.mpr_user_can(uuid,text,text), public.mpr_manage_user(uuid,uuid,jsonb),
  public.mpr_cancel_booking(uuid,uuid,bigint), public.mpr_issue_session(uuid,text,text,timestamptz),
  public.mpr_replace_password(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.mpr_user_can(uuid,text,text), public.mpr_manage_user(uuid,uuid,jsonb),
  public.mpr_cancel_booking(uuid,uuid,bigint), public.mpr_issue_session(uuid,text,text,timestamptz),
  public.mpr_replace_password(uuid,uuid,text,text) to service_role;

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
  v_saved_revision bigint;
  v_saved_type text;
  v_saved_expiry timestamptz;
  v_expiry timestamptz;
  v_hold_minutes integer;
  v_module text;
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

  perform 1 from public.mpr_users where id = p_actor_id for share;
  v_module := case when v_entry_type = 'blocked' then 'calendar_blocks' else 'bookings' end;
  if not public.mpr_user_can(p_actor_id, v_module, case when p_booking_id is null then 'create' else 'edit' end) then
    raise insufficient_privilege using message = 'Booking permission denied';
  end if;

  if p_booking_id is not null then
    select
      case when entry_type = 'blocked' then 'blocked' else booking_status end,
      booking_mode,
      coalesce(entry_status_code, case when entry_type = 'blocked' then 'blocked' else booking_status end),
      coalesce(booking_mode_code, booking_mode), revision, entry_type, hold_expires_at
    into v_saved_status, v_saved_mode, v_saved_status_code, v_saved_mode_code, v_saved_revision, v_saved_type, v_saved_expiry
    from public.calendar_entries
    where id = p_booking_id and status = 'active'
    for update;
    if found and v_saved_type <> v_entry_type then
      if not public.mpr_user_can(p_actor_id, case when v_saved_type = 'blocked' then 'calendar_blocks' else 'bookings' end, 'delete')
        or not public.mpr_user_can(p_actor_id, v_module, 'create') then
        raise insufficient_privilege using message = 'Changing entry type requires permission to cancel the original and create the replacement';
      end if;
    end if;
    if v_saved_revision is null or v_saved_revision is distinct from (p_payload->>'revision')::bigint
       or v_saved_expiry <= clock_timestamp() then
      raise exception 'This entry changed or expired. Refresh and reopen it.' using errcode = 'P4090';
    end if;
  end if;

  if v_status = 'pending' then
    v_expiry := v_saved_expiry;
    if p_payload ? 'hold_minutes' then
      v_hold_minutes := (p_payload->>'hold_minutes')::integer;
      if v_hold_minutes not in (30, 60, 240, 1440) then
        raise exception 'Select a supported hold duration' using errcode = '22023';
      end if;
      v_expiry := case when v_hold_minutes is not null
        then clock_timestamp() + make_interval(mins => v_hold_minutes) end;
    end if;
  elsif p_payload->>'hold_minutes' is not null then
    raise exception 'Only pending reservations can have a hold' using errcode = '22023';
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
  WHERE id = v_venue_id AND is_active = true FOR SHARE;

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

  -- Release expired occupancy before checking the new interval. The exclusion
  -- constraint remains the final arbiter for overlapping concurrent writes.
  if v_saved_expiry <= clock_timestamp() then
    raise exception 'This entry expired. Refresh to see current availability.' using errcode = 'P4090';
  end if;
  update public.calendar_entries
  set status = 'cancelled', updated_by = null
  where venue_id = v_venue_id and status = 'active'
    and id is distinct from p_booking_id
    and hold_expires_at <= clock_timestamp()
    and occupied_range && tstzrange(v_starts_at, v_ends_at, '[)');

  IF p_booking_id IS NULL THEN
    INSERT INTO public.calendar_entries (
      venue_id, entry_type, booking_mode, customer_id,
      event_name, event_type_code, booking_source_code,
      start_date, end_date, start_time, end_time,
      timezone, starts_at, ends_at,
      booking_status, status, block_reason_code, notes, entry_status_code, booking_mode_code,
      hold_expires_at, created_by, updated_by
    )
    VALUES (
      v_venue_id, v_entry_type, v_mode, v_customer_id,
      v_event_name, v_event_type, v_source,
      v_start_date, v_end_date, v_start_time, v_end_time,
      v_timezone, v_starts_at, v_ends_at,
      v_status, 'active', v_block_reason, v_notes, v_status_code, v_mode_code,
      v_expiry, p_actor_id, p_actor_id
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
        hold_expires_at = v_expiry,
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

create function public.mpr_search_bookings(p_actor uuid, p_query text, p_page integer)
returns jsonb language sql stable set search_path = ''
as $$
  with matches as (
    select to_jsonb(e) - 'occupied_range' - 'created_by' - 'updated_by'
      || jsonb_build_object('venue_name', v.venue_name, 'customer_name', c.customer_name,
        'created_actor', case when creator.id is not null then jsonb_build_object('full_name', creator.full_name) end,
        'modified_actor', case when modifier.id is not null then jsonb_build_object('full_name', modifier.full_name) end) as record,
      e.starts_at, e.id
    from public.calendar_entries e
    join public.venues v on v.id = e.venue_id
    left join public.customers c on c.id = e.customer_id
    left join public.mpr_users creator on creator.id = e.created_by
    left join public.mpr_users modifier on modifier.id = e.updated_by
    where public.mpr_user_can(p_actor, case when e.entry_type = 'blocked' then 'calendar_blocks' else 'bookings' end, 'view')
      and (p_query = '' or
        strpos(lower(concat_ws(' ', e.id, e.event_name, c.customer_name, v.venue_name,
          e.start_date, e.end_date, e.entry_status_code, e.booking_status, e.booking_mode_code,
          e.event_type_code, e.booking_source_code, e.block_reason_code, e.entry_type,
          case when e.hold_expires_at <= statement_timestamp() then 'expired'
               when e.hold_expires_at is not null then 'on hold' else e.status end)), lower(p_query)) > 0
        or exists (
          select from (values
            ('entry_statuses', coalesce(e.entry_status_code, e.booking_status, e.entry_type)),
            ('booking_modes', coalesce(e.booking_mode_code, e.booking_mode)),
            ('event_types', e.event_type_code), ('booking_sources', e.booking_source_code),
            ('block_reasons', e.block_reason_code)
          ) field(list_code, value_code)
          join public.lov_lists l using (list_code)
          join public.lov_values lv on lv.list_id = l.id and lv.value_code = field.value_code
          where strpos(lower(lv.display_label), lower(p_query)) > 0
        )
      )
    order by e.starts_at desc, e.id desc
    limit 26 offset (p_page::bigint * 25)
  )
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(record order by starts_at desc, id desc)
    from (select * from matches order by starts_at desc, id desc limit 25) page
  ), '[]'::jsonb), 'has_more', (select count(*) > 25 from matches))
$$;

create function public.mpr_booking_customer_lookup(p_actor uuid, p_query text)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(result) order by result.customer_name, result.id), '[]'::jsonb)
  from (
    select c.id, c.customer_name,
      case when public.mpr_user_can(p_actor, 'customers', 'view') then c.mobile end as mobile,
      case when public.mpr_user_can(p_actor, 'customers', 'view') then c.email end as email
    from public.customers c
    where (public.mpr_user_can(p_actor, 'bookings', 'create') or public.mpr_user_can(p_actor, 'bookings', 'edit'))
      and length(p_query) > 0
      and (strpos(lower(c.customer_name), lower(p_query)) > 0 or c.id::text = lower(p_query)
        or (public.mpr_user_can(p_actor, 'customers', 'view') and (
          strpos(coalesce(c.mobile, ''), p_query) > 0 or strpos(lower(coalesce(c.email, '')), lower(p_query)) > 0
        )))
    order by c.customer_name, c.id
    limit 25
  ) result
$$;

create function public.mpr_availability(p_actor uuid, p_venue uuid, p_start date, p_end date)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'start_date', e.start_date, 'end_date', e.end_date,
        'start_time', e.start_time, 'end_time', e.end_time, 'booking_mode', e.booking_mode,
        'entry_type', e.entry_type, 'is_hold', e.hold_expires_at is not null)
        order by lower(a.occupied_range), a.calendar_entry_id)
      from public.booking_allocations a join public.calendar_entries e on e.id = a.calendar_entry_id
      where public.mpr_user_can(p_actor, 'calendar', 'view') and a.venue_id = p_venue
        and e.start_date <= p_end and e.end_date >= p_start
        and (e.hold_expires_at is null or e.hold_expires_at > statement_timestamp())
    ), '[]'::jsonb),
    'auspicious', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.date, 'title', d.title) order by d.date, d.id)
      from public.auspicious_dates d
      where public.mpr_user_can(p_actor, 'calendar', 'view')
        and public.mpr_user_can(p_actor, 'auspicious_dates', 'view')
        and d.is_active and d.date between p_start and p_end
    ), '[]'::jsonb)
  )
$$;

create function public.mpr_dashboard_counts(p_actor uuid)
returns jsonb language sql stable set search_path = ''
as $$
  with upcoming as (
    select e.entry_type, e.hold_expires_at
    from public.booking_allocations a join public.calendar_entries e on e.id = a.calendar_entry_id
    where upper(a.occupied_range) > statement_timestamp()
      and (e.hold_expires_at is null or e.hold_expires_at > statement_timestamp())
      and public.mpr_user_can(p_actor, 'dashboard', 'view')
  )
  select case when public.mpr_user_can(p_actor, 'dashboard', 'view') then jsonb_strip_nulls(jsonb_build_object(
    'reserved', case when public.mpr_user_can(p_actor, 'bookings', 'view') or public.mpr_user_can(p_actor, 'calendar', 'view')
      then count(*) filter (where entry_type = 'reserved' and hold_expires_at is null) end,
    'holds', case when public.mpr_user_can(p_actor, 'bookings', 'view') or public.mpr_user_can(p_actor, 'calendar', 'view')
      then count(*) filter (where hold_expires_at is not null) end,
    'blocked', case when public.mpr_user_can(p_actor, 'calendar_blocks', 'view') or public.mpr_user_can(p_actor, 'calendar', 'view')
      then count(*) filter (where entry_type = 'blocked') end,
    'auspicious', case when public.mpr_user_can(p_actor, 'auspicious_dates', 'view')
      then (select count(*) from public.auspicious_dates where is_active and date >= (statement_timestamp() at time zone 'Asia/Kolkata')::date) end,
    'venues', case when public.mpr_user_can(p_actor, 'venues', 'view') or public.mpr_user_can(p_actor, 'calendar', 'view')
      then (select count(*) from public.venues where is_active) end
  )) else '{}'::jsonb end
  from upcoming
$$;

revoke all on function public.mpr_search_bookings(uuid,text,integer),
  public.mpr_booking_customer_lookup(uuid,text), public.mpr_availability(uuid,uuid,date,date),
  public.mpr_dashboard_counts(uuid) from public, anon, authenticated;
grant execute on function public.mpr_search_bookings(uuid,text,integer),
  public.mpr_booking_customer_lookup(uuid,text), public.mpr_availability(uuid,uuid,date,date),
  public.mpr_dashboard_counts(uuid) to service_role;

grant select on public.booking_allocations to service_role;

create function public.mpr_search_records(p_actor uuid, p_module text, p_query text, p_page integer)
returns jsonb language sql stable set search_path = ''
as $$
  with permission as materialized (
    select public.mpr_user_can(p_actor, p_module, 'view') as can_view
  ), records as (
    select c.id, lower(c.customer_name) as sort_key, null::date as sort_date, to_jsonb(c) as record,
      c.created_by, c.updated_by, c.customer_category_code as picklist_code, 'customer_categories' as list_code
    from public.customers c, permission where p_module = 'customers' and can_view
    union all
    select v.id, lower(v.venue_name), null::date, to_jsonb(v), v.created_by, v.updated_by, v.venue_type_code, 'venue_types'
    from public.venues v, permission where p_module = 'venues' and can_view
    union all
    select d.id, lower(d.title), d.date,
      to_jsonb(d), d.created_by, d.updated_by, d.category_code, 'auspicious_categories'
    from public.auspicious_dates d, permission where p_module = 'auspicious_dates' and can_view
  ), matches as (
    select r.record - 'created_by' - 'updated_by'
      || jsonb_build_object(
        'created_actor', case when creator.id is not null then jsonb_build_object('full_name', creator.full_name) end,
        'modified_actor', case when modifier.id is not null then jsonb_build_object('full_name', modifier.full_name) end
      ) as record, r.sort_key, r.sort_date, r.id
    from records r
    left join public.mpr_users creator on creator.id = r.created_by
    left join public.mpr_users modifier on modifier.id = r.updated_by
    where p_query = '' or exists (
      select from jsonb_each_text(r.record - 'created_by' - 'updated_by') field
      where strpos(lower(field.value), lower(p_query)) > 0
    ) or exists (
      select from public.lov_lists l join public.lov_values v on v.list_id = l.id
      where ((l.list_code = r.list_code and v.value_code = r.picklist_code)
        or (l.list_code = 'regions' and v.value_code = r.record->>'region_code'))
        and strpos(lower(v.display_label), lower(p_query)) > 0
    )
    order by sort_date desc nulls last, sort_key, r.id
    limit 26 offset (p_page::bigint * 25)
  )
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(record order by sort_date desc nulls last, sort_key, id)
    from (select * from matches order by sort_date desc nulls last, sort_key, id limit 25) page
  ), '[]'::jsonb), 'has_more', (select count(*) > 25 from matches))
$$;

create function public.mpr_active_venues(p_actor uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'venue_name', venue_name, 'venue_code', venue_code, 'timezone', timezone
  ) order by venue_name, id), '[]'::jsonb)
  from public.venues where is_active and (
    public.mpr_user_can(p_actor, 'venues', 'view') or public.mpr_user_can(p_actor, 'calendar', 'view')
    or public.mpr_user_can(p_actor, 'bookings', 'view') or public.mpr_user_can(p_actor, 'calendar_blocks', 'view')
  )
$$;

revoke all on function public.mpr_search_records(uuid,text,text,integer), public.mpr_active_venues(uuid)
  from public, anon, authenticated;
grant execute on function public.mpr_search_records(uuid,text,text,integer), public.mpr_active_venues(uuid)
  to service_role;

