-- MPR migration 001: extensions, profile, venues, customers, bookings, LOVs, audit.
-- Apply to a fresh Supabase project.

create extension if not exists btree_gist with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  role text not null default 'staff'
    check (role in ('admin','manager','staff','viewer')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  venue_name text not null,
  venue_code text unique,
  venue_type_code text,
  address text,
  city text,
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  mobile text,
  email text,
  address text,
  city text,
  customer_category_code text,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_mobile_idx on public.customers(mobile);
create index customers_name_idx on public.customers using gin (to_tsvector('simple', customer_name));

-- A single table supports both reserved and blocked occupancy.
-- Full-day: start_date through end_date inclusive, converted to [start midnight, day-after-end midnight).
-- Time-slot: same-day only, [start_time, end_time).
create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  entry_type text not null check (entry_type in ('reserved','blocked')),
  booking_mode text not null check (booking_mode in ('full_day','time_slot')),
  customer_id uuid references public.customers(id),
  event_name text,
  event_type_code text,
  booking_source_code text,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  timezone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  booking_status text check (booking_status in ('pending','confirmed')),
  status text not null default 'active' check (status in ('active','cancelled')),
  block_reason_code text,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_valid_dates check (end_date >= start_date),
  constraint calendar_valid_interval check (ends_at > starts_at),
  constraint calendar_mode_shape check (
    (booking_mode = 'full_day' and start_time is null and end_time is null)
    or
    (booking_mode = 'time_slot' and start_date = end_date
      and start_time is not null and end_time is not null and end_time > start_time)
  ),
  constraint calendar_entry_shape check (
    (entry_type = 'reserved' and customer_id is not null
      and booking_status is not null and block_reason_code is null)
    or
    (entry_type = 'blocked' and customer_id is null
      and booking_status is null and block_reason_code is not null)
  ),
  constraint prevent_venue_overlap exclude using gist (
    venue_id with =,
    occupied_range with &&
  ) where (status = 'active')
);

create index calendar_venue_start_idx on public.calendar_entries(venue_id, starts_at);
create index calendar_customer_idx on public.calendar_entries(customer_id);
create index calendar_type_status_idx on public.calendar_entries(entry_type, status);

create table public.auspicious_dates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  category_code text,
  description text,
  region_code text,
  source text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auspicious_dates_date_idx on public.auspicious_dates(date) where is_active;

-- LOV metadata and values. Codes are stable identifiers; labels are admin-editable.
create table public.lov_lists (
  id uuid primary key default gen_random_uuid(),
  list_code text not null unique,
  list_name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lov_list_code_format check (list_code ~ '^[a-z][a-z0-9_]{1,62}$')
);

create table public.lov_values (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lov_lists(id) on delete restrict,
  value_code text not null,
  display_label text not null,
  description text,
  extra_data jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lov_value_code_format check (value_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint lov_unique_code unique(list_id, value_code),
  constraint lov_unique_label unique(list_id, display_label)
);

create index lov_values_list_active_sort_idx
  on public.lov_values(list_id, is_active, sort_order);

create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null check (module in (
    'dashboard','calendar','bookings','calendar_blocks','customers',
    'venues','auspicious_dates','users','reports','lovs'
  )),
  action text not null check (action in ('view','create','edit','delete')),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(user_id, module, action)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_user_created_idx on public.audit_logs(user_id, created_at desc);

-- Seed configurable LOV lists and starter values.
insert into public.lov_lists(list_code, list_name, description, is_system)
values
 ('event_types','Event Types','Types of events accepted by MPR',false),
 ('block_reasons','Block Reasons','Reasons a venue/date/time is blocked',false),
 ('customer_categories','Customer Categories','Customer classification',false),
 ('venue_types','Venue Types','Types of halls or event spaces',false),
 ('auspicious_categories','Auspicious Categories','Categories for auspicious dates',false),
 ('booking_sources','Booking Sources','How a booking was received',false),
 ('regions','Regions','Region or calendar locality',false)
on conflict (list_code) do nothing;

insert into public.lov_values(list_id, value_code, display_label, sort_order)
select l.id, v.code, v.label, v.ord
from public.lov_lists l
join (values
 ('event_types','wedding','Wedding',10),
 ('event_types','reception','Reception',20),
 ('event_types','birthday','Birthday',30),
 ('event_types','corporate','Corporate Event',40),
 ('event_types','other','Other',90),
 ('block_reasons','maintenance','Maintenance',10),
 ('block_reasons','private_use','Private Use',20),
 ('block_reasons','renovation','Renovation',30),
 ('block_reasons','other','Other',90),
 ('customer_categories','individual','Individual',10),
 ('customer_categories','company','Company',20),
 ('customer_categories','planner','Event Planner',30),
 ('venue_types','banquet_hall','Banquet Hall',10),
 ('venue_types','outdoor','Outdoor Venue',20),
 ('venue_types','conference','Conference Space',30),
 ('auspicious_categories','marriage_muhurtham','Marriage Muhurtham',10),
 ('auspicious_categories','festival','Festival',20),
 ('auspicious_categories','religious','Religious Occasion',30),
 ('auspicious_categories','general','General',90),
 ('booking_sources','phone','Phone',10),
 ('booking_sources','walk_in','Walk-in',20),
 ('booking_sources','website','Website',30),
 ('booking_sources','referral','Referral',40),
 ('regions','india','India',10)
) as v(list_code, code, label, ord)
  on l.list_code = v.list_code
on conflict (list_id, value_code) do nothing;
