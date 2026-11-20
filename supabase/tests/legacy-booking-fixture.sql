insert into public.mpr_users (id, username, full_name, role, password_hash)
values ('00000000-0000-4000-8000-000000000101', 'upgrade_fixture', 'Upgrade fixture', 'admin', 'unused fixture');

insert into public.venues (id, venue_name)
values ('00000000-0000-4000-8000-000000000102', 'Upgrade fixture venue');

insert into public.customers (id, customer_name, customer_category_code, created_by)
values ('00000000-0000-4000-8000-000000000103', 'Upgrade fixture customer', 'individual',
  '00000000-0000-4000-8000-000000000101');

insert into public.calendar_entries (
  id, venue_id, customer_id, entry_type, booking_mode, event_name, start_date, end_date,
  timezone, starts_at, ends_at, booking_status, created_by
) values (
  '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103', 'reserved', 'full_day', 'Upgrade fixture booking',
  '2098-01-01', '2098-01-01', 'Asia/Kolkata', '2098-01-01 00:00+05:30',
  '2098-01-02 00:00+05:30', 'confirmed', '00000000-0000-4000-8000-000000000101'
);
