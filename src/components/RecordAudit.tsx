import { auditFields, type RecordAudit } from "../lib/recordAudit";

export function AuditHeaders() {
  return <>{auditFields({}).map(([label]) => <th key={label}>{label}</th>)}</>;
}

export function AuditCells({ record }: { record: RecordAudit }) {
  return <>{auditFields(record).map(([label, value]) => <td key={label}>{value}</td>)}</>;
}
