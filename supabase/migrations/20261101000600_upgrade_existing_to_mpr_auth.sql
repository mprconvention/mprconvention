-- MPR migration 006: upgrade an existing Auth-based MPR database to MPR-managed accounts.
-- Run ONLY after the original MPR migrations 001-005 have succeeded.
-- Does not drop business data. Legacy profiles are retained for rollback/reference.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mpr_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  email text,
  password_hash text not null,
  full_name text not null,
  phone text,
  role text not null default 'staff' check (role in ('admin','manager','staff','viewer')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mpr_users_username_format check (username ~ '^[A-Za-z0-9_.-]{3,50}$')
);
create unique index if not exists mpr_users_username_lower_uq on public.mpr_users (lower(username));
create unique index if not exists mpr_users_email_lower_uq on public.mpr_users (lower(email)) where email is not null;

create table if not exists public.mpr_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.mpr_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists mpr_sessions_user_idx on public.mpr_sessions(user_id);
create index if not exists mpr_sessions_expiry_idx on public.mpr_sessions(expires_at);

-- Preserve legacy user IDs so existing created_by/updated_by references can be reassigned.
-- Imported accounts are disabled and receive random unknown passwords; an administrator
-- must create/reset their MPR credentials. Supabase Auth passwords are not copied.
do $$
declare p record; v_base text; v_username text;
begin
  for p in select id, full_name, email, phone, role, created_at from public.profiles loop
    if not exists (select 1 from public.mpr_users u where u.id = p.id) then
      v_base := lower(regexp_replace(coalesce(nullif(split_part(coalesce(p.email,''),'@',1),''),'legacy'), '[^a-z0-9_.-]', '_', 'g'));
      v_username := left(v_base, 40) || '_' || left(replace(p.id::text,'-',''),8);
      insert into public.mpr_users(id, username, email, full_name, phone, role,
                                   password_hash, is_active, must_change_password, created_at)
      values (p.id, v_username, p.email, coalesce(nullif(p.full_name,''),'Legacy MPR User'), p.phone,
              case when p.role in ('admin','manager','staff','viewer') then p.role else 'staff' end,
              extensions.crypt(extensions.gen_random_uuid()::text, extensions.gen_salt('bf',12)),
              false, true, coalesce(p.created_at,now()));
    end if;
  end loop;
end $$;

-- Remove old triggers that overwrite MPR actor IDs with auth.uid() (NULL for custom sessions).
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists calendar_entry_prepare on public.calendar_entries;
drop trigger if exists customers_prepare on public.customers;
drop trigger if exists auspicious_prepare on public.auspicious_dates;
drop trigger if exists lov_values_prepare on public.lov_values;
drop trigger if exists profiles_prepare on public.profiles;
drop trigger if exists audit_profiles on public.profiles;

-- Repoint all existing foreign keys that referenced profiles to mpr_users.
do $$
declare c record;
begin
  for c in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype='f' and confrelid='public.profiles'::regclass
  loop
    execute format('alter table %s drop constraint %I', c.table_name, c.conname);
  end loop;
end $$;

-- Recreate the known actor/user relationships against MPR's own user table.
alter table public.customers
  add constraint customers_created_by_mpr_fk foreign key (created_by) references public.mpr_users(id),
  add constraint customers_updated_by_mpr_fk foreign key (updated_by) references public.mpr_users(id);
alter table public.calendar_entries
  add constraint calendar_created_by_mpr_fk foreign key (created_by) references public.mpr_users(id),
  add constraint calendar_updated_by_mpr_fk foreign key (updated_by) references public.mpr_users(id);
alter table public.auspicious_dates
  add constraint auspicious_created_by_mpr_fk foreign key (created_by) references public.mpr_users(id),
  add constraint auspicious_updated_by_mpr_fk foreign key (updated_by) references public.mpr_users(id);
alter table public.user_permissions
  add constraint user_permissions_user_mpr_fk foreign key (user_id) references public.mpr_users(id) on delete cascade,
  add constraint user_permissions_granted_by_mpr_fk foreign key (granted_by) references public.mpr_users(id);
alter table public.lov_values
  add constraint lov_values_created_by_mpr_fk foreign key (created_by) references public.mpr_users(id),
  add constraint lov_values_updated_by_mpr_fk foreign key (updated_by) references public.mpr_users(id);
update public.audit_logs a set user_id = null where user_id is not null and not exists (select 1 from public.mpr_users u where u.id = a.user_id);
alter table public.audit_logs
  add constraint audit_logs_user_mpr_fk foreign key (user_id) references public.mpr_users(id) on delete set null;

-- Keep the old profiles table only as a locked legacy reference; no MPR login uses it.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

-- MPR browser clients must use the Edge Functions. The service role is server-side only.
do $$ declare t text; begin
  foreach t in array array['mpr_users','mpr_sessions','profiles','user_permissions','venues','customers',
    'calendar_entries','auspicious_dates','lov_lists','lov_values','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

-- Old Auth-based provisioning RPCs are no longer part of the MPR security model.
drop function if exists public.admin_apply_user_setup(uuid,text,jsonb);
drop function if exists public.admin_update_user_access(uuid,text,boolean,jsonb);

-- Prevent use of legacy Auth helper functions by browser roles. Legacy objects are retained
-- where dropping them could affect rollback; they are no longer used by the custom-auth API.
revoke all on all functions in schema public from public, anon, authenticated;

comment on table public.mpr_users is 'MPR application accounts; independent of Supabase Auth.';
comment on table public.mpr_sessions is 'Hashed bearer sessions for MPR custom authentication.';
comment on table public.profiles is 'Legacy Supabase-Auth profile table retained for rollback; not used by MPR login.';
