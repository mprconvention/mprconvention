// Explicit foreign key names disambiguate each actor relationship in PostgREST.
export function recordActors(prefix: string, suffix = "_fkey") {
  return [
    `created_actor:mpr_users!${prefix}_created_by${suffix}(full_name)`,
    `modified_actor:mpr_users!${prefix}_updated_by${suffix}(full_name)`,
  ].join(",");
}

export function recordAudit(prefix: string, suffix?: string) {
  return `created_at,updated_at,${recordActors(prefix, suffix)}`;
}
