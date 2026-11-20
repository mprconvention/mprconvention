-- Keep the existing triggers and permissions while disambiguating the selected
-- picklist value from the lov_values.value_code column.
create or replace function public.mpr_validate_picklists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row jsonb := to_jsonb(new);
  previous_row jsonb;
  i integer := 0;
  field_name text;
  v_selected_code text;
begin
  if tg_op = 'UPDATE' then previous_row := to_jsonb(old); end if;
  while i < tg_nargs loop
    field_name := tg_argv[i];
    v_selected_code := current_row->>field_name;
    if not current_row ? field_name or i + 1 >= tg_nargs then
      raise exception 'Invalid picklist binding for %.%', tg_table_name, field_name;
    end if;
    if v_selected_code is not null and v_selected_code is distinct from previous_row->>field_name then
      -- Row locks serialize selection of a value with changes to its active state.
      perform 1 from public.lov_lists l
      join public.lov_values v on v.list_id = l.id
      where l.list_code = tg_argv[i + 1] and l.is_active
        and v.value_code = v_selected_code and v.is_active
      for share of l, v;
      if not found then
        raise exception 'Invalid or inactive % value: %', field_name, v_selected_code
          using errcode = '23514';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;
