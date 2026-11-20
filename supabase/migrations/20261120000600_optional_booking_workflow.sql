alter table public.user_permissions drop constraint user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check check (module in (
  'dashboard', 'calendar', 'bookings', 'calendar_blocks', 'customers', 'venues',
  'auspicious_dates', 'users', 'reports', 'lovs', 'booking_workflow'
));

create table public.booking_workflow_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.calendar_entries(id),
  kind text not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  status text not null,
  amount numeric(14,2),
  due_at timestamptz,
  notes text check (length(notes) <= 4000),
  created_by uuid not null references public.mpr_users(id),
  updated_by uuid references public.mpr_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_workflow_status check (
    (kind = 'inquiry' and status in ('new', 'contacted', 'closed'))
    or (kind = 'quote' and status in ('draft', 'shared', 'accepted', 'declined'))
    or (kind = 'deposit' and status in ('expected', 'received', 'refunded'))
    or (kind = 'reminder' and status in ('scheduled', 'completed', 'dismissed'))
    or (kind = 'instructions' and status in ('draft', 'ready'))
  ),
  check ((kind in ('quote', 'deposit') and amount is not null and amount >= 0) or
         (kind not in ('quote', 'deposit') and amount is null)),
  check (kind <> 'reminder' or due_at is not null),
  check (kind not in ('deposit', 'instructions') or booking_id is not null)
);
alter table public.booking_workflow_items enable row level security;
revoke all on public.booking_workflow_items from public, anon, authenticated;
grant select, insert, update on public.booking_workflow_items to service_role;

create index booking_workflow_booking_idx on public.booking_workflow_items (booking_id, created_at desc, id desc);
create index booking_workflow_kind_idx on public.booking_workflow_items (kind, created_at desc, id desc);
create trigger zz_mpr_stamp before insert or update on public.booking_workflow_items
for each row execute function public.mpr_stamp_record();
create trigger audit_booking_workflow after insert or update on public.booking_workflow_items
for each row execute function public.write_audit_log();

create function public.mpr_guard_linked_reservation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.entry_type is distinct from old.entry_type and exists (
    select from public.booking_workflow_items where booking_id = old.id
  ) then
    raise exception 'This reservation has linked workflow records and cannot become a venue block.' using errcode = 'P4090';
  end if;
  return new;
end;
$$;
create trigger mpr_guard_linked_reservation before update of entry_type on public.calendar_entries
for each row execute function public.mpr_guard_linked_reservation();
revoke all on function public.mpr_guard_linked_reservation() from public, anon, authenticated;

create function public.mpr_list_booking_workflow(p_actor uuid, p_booking uuid, p_kind text, p_query text, p_page integer)
returns jsonb language sql stable set search_path = ''
as $$
  with access as materialized (
    select public.mpr_user_can(p_actor, 'booking_workflow', 'view') as can_view,
      public.mpr_user_can(p_actor, 'bookings', 'view') as can_view_bookings
  ), matches as (
    select to_jsonb(item) - 'created_by' - 'updated_by'
      || jsonb_build_object('booking_name', e.event_name) as record, item.created_at, item.id
    from public.booking_workflow_items item cross join access
    left join public.calendar_entries e on access.can_view_bookings and e.id = item.booking_id
    where access.can_view and (item.booking_id is null or access.can_view_bookings)
      and (p_booking is null or item.booking_id = p_booking)
      and (p_kind is null or item.kind = p_kind)
      and (p_query = '' or strpos(lower(concat_ws(' ', item.title, item.status, e.event_name, item.notes)), lower(p_query)) > 0)
    order by item.created_at desc, item.id desc
    limit 26 offset (p_page::bigint * 25)
  )
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(record order by created_at desc, id desc)
    from (select * from matches order by created_at desc, id desc limit 25) page
  ), '[]'::jsonb), 'has_more', (select count(*) > 25 from matches))
$$;

create function public.mpr_save_booking_workflow(p_actor uuid, p_id uuid, p_record jsonb)
returns uuid language plpgsql set search_path = ''
as $$
declare
  item public.booking_workflow_items%rowtype;
  booking uuid := nullif(p_record->>'booking_id', '')::uuid;
  item_kind text := p_record->>'kind';
begin
  perform 1 from public.mpr_users where id = p_actor for share;
  if not public.mpr_user_can(p_actor, 'booking_workflow', case when p_id is null then 'create' else 'edit' end) then
    raise insufficient_privilege using message = 'Booking workflow permission required';
  end if;
  if booking is not null and not public.mpr_user_can(p_actor, 'bookings', 'view') then
    raise insufficient_privilege using message = 'Booking view permission required to link a reservation';
  end if;
  if booking is not null then
    perform 1 from public.calendar_entries where id = booking and entry_type = 'reserved' for share;
    if not found then raise exception 'Select an existing reservation' using errcode = '22023'; end if;
  end if;

  if p_id is null then
    insert into public.booking_workflow_items (booking_id, kind, title, status, amount, due_at, notes, created_by)
    values (booking, item_kind, p_record->>'title', p_record->>'status', (p_record->>'amount')::numeric,
      (p_record->>'due_at')::timestamptz, p_record->>'notes', p_actor)
    returning id into p_id;
  else
    select * into item from public.booking_workflow_items where id = p_id for update;
    if not found then raise no_data_found using message = 'Workflow record not found'; end if;
    if item.booking_id is distinct from booking or item.kind is distinct from item_kind then
      raise exception 'The workflow record type and reservation link are fixed' using errcode = '22023';
    end if;
    if item.updated_at is distinct from (p_record->>'updated_at')::timestamptz then
      raise exception 'This workflow record changed. Refresh before saving.' using errcode = 'P4090';
    end if;
    update public.booking_workflow_items set title = p_record->>'title', status = p_record->>'status',
      amount = (p_record->>'amount')::numeric, due_at = (p_record->>'due_at')::timestamptz,
      notes = p_record->>'notes', updated_by = p_actor where id = p_id;
  end if;
  return p_id;
end;
$$;

revoke all on function public.mpr_list_booking_workflow(uuid,uuid,text,text,integer),
  public.mpr_save_booking_workflow(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mpr_list_booking_workflow(uuid,uuid,text,text,integer),
  public.mpr_save_booking_workflow(uuid,uuid,jsonb) to service_role;
