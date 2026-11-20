import { auditFields, type RecordAudit } from "../lib/recordAudit";

export function AuditHeaders() {
  return <>{auditFields({}).map(([label]) => <th key={label}>{label}</th>)}</>;
}

export function AuditCells({ record }: { record: RecordAudit }) {
  return <>{auditFields(record).map(([label, value]) => <td key={label}>{value}</td>)}</>;
}

export function AuditDetails({ record }: { record: RecordAudit }) {
  return <dl className="record-audit">
    {auditFields(record).map(([label, value]) => (
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
    ))}
  </dl>;
}
