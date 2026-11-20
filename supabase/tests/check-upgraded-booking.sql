do $$
begin
  if not exists (
    select 1 from public.calendar_entries e
    join public.booking_allocations a on a.calendar_entry_id = e.id
    join public.customers c on c.id = e.customer_id
    where e.id = '00000000-0000-4000-8000-000000000104'
      and e.event_name = 'Upgrade fixture booking' and e.revision = 1
      and a.venue_id = e.venue_id and a.occupied_range = e.occupied_range
      and c.customer_category_code = 'individual'
  ) then
    raise exception 'The upgrade failed to preserve a booking, its allocation, or its customer category';
  end if;
  if has_function_privilege('anon', 'public.mpr_save_booking(uuid,uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.mpr_manage_user(uuid,uuid,jsonb)', 'execute')
    or has_table_privilege('anon', 'public.calendar_entries', 'select')
    or has_table_privilege('authenticated', 'public.booking_allocations', 'select') then
    raise exception 'Direct browser access to privileged tables or functions';
  end if;
end;
$$;
