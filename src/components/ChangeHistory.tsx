import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "../lib/mprAuth";
import { formatAuditDate } from "../lib/recordAudit";

const modules: Record<string, string> = {
  calendar_entries: "Bookings and blocks",
  customers: "Customers",
  venues: "Venues",
  auspicious_dates: "Auspicious dates",
  lov_lists: "Picklists",
  lov_values: "Picklist values",
  mpr_users: "User accounts",
  user_permissions: "User permissions",
};
const actions: Record<string, string> = { INSERT: "Created", UPDATE: "Modified", DELETE: "Deleted" };

type ChangeValue = string | number | boolean | null;
type HistoryRecord = {
  audit_id: string;
  table_name: string;
  record_id: string | null;
  record_label: string | null;
  action: string;
  created_at: string;
  actor: { full_name: string } | null;
  changes: { field: string; previous: ChangeValue; current: ChangeValue }[];
};
type Page = { data: HistoryRecord[]; next: string | null };

export function ChangeHistory({ supabase }: { supabase: SupabaseClient }) {
  const [table, setTable] = useState("");
  const [action, setAction] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const before = cursors[cursors.length - 1];

  useEffect(() => {
    let current = true;
    setPage(null);
    setError("");
    mprInvoke<Page>(supabase, "mpr-api", {
      action: "list-change-history",
      table_name: table || null,
      change_action: action || null,
      before,
    }).then(result => {
      if (current) setPage(result);
    }).catch((error: unknown) => {
      if (current) setError(error instanceof Error ? error.message : "Unable to load change history.");
    });
    return () => { current = false; };
  }, [supabase, table, action, before, revision]);

  return <section className="master-module">
    <div className="master-toolbar">
      <div className="master-actions">
        <label>Module{" "}<select value={table} onChange={event => {
          setTable(event.target.value);
          setCursors([null]);
        }}>
          <option value="">All modules</option>
          {Object.entries(modules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Action{" "}<select value={action} onChange={event => {
          setAction(event.target.value);
          setCursors([null]);
        }}>
          <option value="">All actions</option>
          {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
      <button className="outline-btn" onClick={() => {
        setCursors([null]);
        setRevision(value => value + 1);
      }}>Refresh</button>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="master-table-wrap">
      <table className="master-table">
        <thead><tr><th>Date/time (IST)</th><th>Changed by</th><th>Module</th><th>Record</th><th>Action</th><th>Field changes</th></tr></thead>
        <tbody>
          {page?.data.map(entry => <tr key={entry.audit_id}>
            <td>{formatAuditDate(entry.created_at)}</td>
            <td>{entry.actor?.full_name ?? "Not recorded"}</td>
            <td>{modules[entry.table_name]}</td>
            <td>
              <strong>{entry.record_label ?? "—"}</strong>
              {entry.record_id && entry.record_id !== entry.record_label &&
                <div className="history-record-id muted">{entry.record_id}</div>}
            </td>
            <td>{actions[entry.action]}</td>
            <td>{entry.changes.length ? <details>
              <summary>{entry.changes.length} {entry.changes.length === 1 ? "field" : "fields"}</summary>
              <table className="history-differences">
                <thead><tr><th>Field</th><th>Previous</th><th>New</th></tr></thead>
                <tbody>{entry.changes.map(change => <tr key={change.field}>
                  <td>{change.field.replaceAll("_", " ")}</td>
                  <td>{String(change.previous ?? "—")}</td>
                  <td>{String(change.current ?? "—")}</td>
                </tr>)}</tbody>
              </table>
            </details> : "No tracked field differences"}</td>
          </tr>)}
          {(!page || !page.data.length) && <tr><td colSpan={6} className="master-empty">
            {error ? "History unavailable" : page ? "No changes found." : "Loading change history."}
          </td></tr>}
        </tbody>
      </table>
    </div>
    <div className="master-actions history-pagination">
      <button className="outline-btn" disabled={cursors.length === 1 || !page} onClick={() => setCursors(cursors.slice(0, -1))}>Newer</button>
      <button className="outline-btn" disabled={!page?.next} onClick={() => {
        if (page?.next) setCursors([...cursors, page.next]);
      }}>Older</button>
    </div>
  </section>;
}
