export type RecordAudit = {
  created_at?: string | null;
  updated_at?: string | null;
  created_actor?: { full_name: string } | null;
  modified_actor?: { full_name: string } | null;
};

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Kolkata",
});

export function formatAuditDate(value: string) {
  return dateTime.format(new Date(value));
}

export function auditFields(record: RecordAudit) {
  return [
    ["Created by", record.created_actor?.full_name ?? "Not recorded"],
    ["Created date/time", record.created_at ? formatAuditDate(record.created_at) : "Not recorded"],
    ["Modified by", record.modified_actor?.full_name ?? "Not recorded"],
    ["Modified date/time", record.updated_at ? formatAuditDate(record.updated_at) : "Not recorded"],
  ];
}
