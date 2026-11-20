-- These versions have to be reconciled with the deployed schema before a
-- release can add migrations. This check does not change the database.
do $$
declare
  missing text[];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Production migration history is missing. Reconcile the deployed schema before releasing.';
  end if;

  select array_agg(baseline.version order by baseline.version) into missing
  from unnest(array[
    '20261101000100','20261101000200','20261101000300','20261101000400','20261101000500',
    '20261101000600','20261102000100','20261120000100','20261120000200','20261120000300'
  ]) baseline(version)
  where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = baseline.version);

  if missing is not null then
    raise exception 'Reconcile historical migration versions before releasing: %', array_to_string(missing, ', ');
  end if;
end;
$$;
