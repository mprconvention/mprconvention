-- MPR migration 003: RLS policies and SQL grants.

alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.venues enable row level security;
alter table public.customers enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.auspicious_dates enable row level security;
alter table public.lov_lists enable row level security;
alter table public.lov_values enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES
create policy profiles_select_self_admin on public.profiles
for select to authenticated
using (
  public.is_active_user()
  and (id = (select auth.uid()) or public.is_admin())
);

create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- No client-side profile insert/delete. Auth trigger creates profiles.

-- USER PERMISSIONS
create policy permissions_select_self_admin on public.user_permissions
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy permissions_admin_all on public.user_permissions
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- VENUES
create policy venues_select on public.venues
for select to authenticated
using (public.has_permission('venues','view') or public.has_permission('calendar','view'));

create policy venues_admin_all on public.venues
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- CUSTOMERS: shared customer records
create policy customers_select on public.customers
for select to authenticated
using (public.has_permission('customers','view'));

create policy customers_insert on public.customers
for insert to authenticated
with check (
  public.has_permission('customers','create')
  and created_by = (select auth.uid())
);

create policy customers_update on public.customers
for update to authenticated
using (public.has_permission('customers','edit'))
with check (public.has_permission('customers','edit'));

create policy customers_delete on public.customers
for delete to authenticated
using (public.has_permission('customers','delete'));

-- CALENDAR: calendar view permission controls visibility of all entries.
create policy calendar_select on public.calendar_entries
for select to authenticated
using (public.has_permission('calendar','view'));

create policy calendar_insert on public.calendar_entries
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (entry_type = 'reserved' and public.has_permission('bookings','create'))
    or
    (entry_type = 'blocked' and public.has_permission('calendar_blocks','create'))
  )
);

create policy calendar_update on public.calendar_entries
for update to authenticated
using (
  (entry_type = 'reserved' and public.has_permission('bookings','edit'))
  or
  (entry_type = 'blocked' and public.has_permission('calendar_blocks','edit'))
)
with check (
  (entry_type = 'reserved' and public.has_permission('bookings','edit'))
  or
  (entry_type = 'blocked' and public.has_permission('calendar_blocks','edit'))
);

create policy calendar_delete on public.calendar_entries
for delete to authenticated
using (
  (entry_type = 'reserved' and public.has_permission('bookings','delete'))
  or
  (entry_type = 'blocked' and public.has_permission('calendar_blocks','delete'))
);

-- AUSPICIOUS DATES: managers and admins receive CRUD via has_permission.
create policy auspicious_select on public.auspicious_dates
for select to authenticated
using (public.has_permission('auspicious_dates','view'));

create policy auspicious_insert on public.auspicious_dates
for insert to authenticated
with check (
  public.has_permission('auspicious_dates','create')
  and created_by = (select auth.uid())
);

create policy auspicious_update on public.auspicious_dates
for update to authenticated
using (public.has_permission('auspicious_dates','edit'))
with check (public.has_permission('auspicious_dates','edit'));

create policy auspicious_delete on public.auspicious_dates
for delete to authenticated
using (public.has_permission('auspicious_dates','delete'));

-- LOVs: authenticated users may read active lists/values if they can use app.
-- Only admin can create/change list definitions and values.
create policy lov_lists_read on public.lov_lists
for select to authenticated
using (public.is_active_user() and is_active);

create policy lov_lists_admin_manage on public.lov_lists
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy lov_values_read on public.lov_values
for select to authenticated
using (
  public.is_active_user()
  and is_active
  and exists (
    select 1 from public.lov_lists l
    where l.id = list_id and l.is_active
  )
);

create policy lov_values_admin_manage on public.lov_values
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- AUDIT: admin read only
create policy audit_admin_read on public.audit_logs
for select to authenticated
using (public.is_admin());

-- SQL privileges. RLS remains the row/operation gate.
grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_permissions to authenticated;
grant select, insert, update, delete on public.venues to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.calendar_entries to authenticated;
grant select, insert, update, delete on public.auspicious_dates to authenticated;
grant select, insert, update, delete on public.lov_lists to authenticated;
grant select, insert, update, delete on public.lov_values to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on public.profiles, public.user_permissions, public.venues,
  public.customers, public.calendar_entries, public.auspicious_dates,
  public.lov_lists, public.lov_values, public.audit_logs
from anon;

-- Ensure no direct authenticated writes to audit log.
revoke insert, update, delete on public.audit_logs from authenticated;
