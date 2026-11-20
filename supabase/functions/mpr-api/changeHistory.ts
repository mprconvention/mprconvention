import { db, reply } from "../_shared/auth.ts";

const fields: Readonly<Record<string, readonly string[]>> = {
  calendar_entries: ["event_name","venue_id","customer_id","entry_type","entry_status_code","booking_status","booking_mode_code","booking_mode","event_type_code","booking_source_code","block_reason_code","start_date","end_date","start_time","end_time","timezone","status","hold_expires_at","notes"],
  booking_workflow_items: ["kind","booking_id","title","status","amount","due_at","notes"],
  customers: ["customer_name","mobile","email","address","city","customer_category_code","notes"],
  venues: ["venue_name","venue_code","venue_type_code","address","city","timezone","is_active"],
  auspicious_dates: ["date","title","category_code","region_code","description","source","is_active"],
  lov_lists: ["list_name","list_code","description","sort_order","is_active"],
  lov_values: ["list_id","value_code","display_label","description","sort_order","is_active","is_default","behavior"],
  mpr_users: ["username","full_name","role","is_active","must_change_password"],
  user_permissions: ["user_id","module","action","granted_by"],
};

const actions = ["INSERT", "UPDATE", "DELETE"];
const pageSize = 25;
type Snapshot = Record<string, unknown> | null;

function fieldValue(row: Snapshot, field: string) {
  const value = field === "behavior"
    ? (row?.extra_data as {behavior?: unknown} | undefined)?.behavior
    : row?.[field];
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number" ? value : null;
}

function recordLabel(row: Snapshot, id: string | null) {
  for (const field of ["event_name","customer_name","venue_name","title","list_name","display_label","full_name","module"]) {
    if (typeof row?.[field] === "string" && row[field]) return row[field];
  }
  return id;
}

export async function listChangeHistory(params: Record<string, unknown>) {
  const table = params.table_name;
  const action = params.change_action;
  const before = params.before;
  if (table != null && (typeof table !== "string" || !Object.hasOwn(fields, table))) {
    return reply({ error: "Unknown history module" }, 400);
  }
  if (action != null && (typeof action !== "string" || !actions.includes(action))) {
    return reply({ error: "Unknown change action" }, 400);
  }
  if (before != null && (typeof before !== "string" || !/^[1-9][0-9]{0,18}$/.test(before)
      || BigInt(before) > 9223372036854775807n)) {
    return reply({ error: "Invalid history cursor" }, 400);
  }

  let query = db.from("audit_logs")
    .select("audit_id:id::text,table_name,record_id,action,created_at,old_data,new_data,actor:mpr_users!audit_logs_user_mpr_fk(full_name)")
    .in("table_name", Object.keys(fields))
    .in("action", actions)
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (typeof table === "string") query = query.eq("table_name", table);
  if (typeof action === "string") query = query.eq("action", action);
  if (typeof before === "string") query = query.lt("id", before);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const page = rows.slice(0, pageSize);
  return reply({
    data: page.map(({ old_data, new_data, ...event }) => ({
      ...event,
      record_label: recordLabel(new_data ?? old_data, event.record_id),
      changes: fields[event.table_name].flatMap(field => {
        const previous = fieldValue(old_data, field);
        const current = fieldValue(new_data, field);
        return previous === current ? [] : [{ field, previous, current }];
      }),
    })),
    next: rows.length > pageSize ? page[page.length - 1].audit_id : null,
  });
}
