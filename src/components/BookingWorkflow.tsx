import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "../lib/mprAuth";

const kinds = {
  inquiry: { label: "Inquiry", statuses: ["new", "contacted", "closed"] },
  quote: { label: "Quote", statuses: ["draft", "shared", "accepted", "declined"] },
  deposit: { label: "Deposit", statuses: ["expected", "received", "refunded"] },
  reminder: { label: "Reminder", statuses: ["scheduled", "completed", "dismissed"] },
  instructions: { label: "Event-day instructions", statuses: ["draft", "ready"] },
};
type Kind = keyof typeof kinds;
export type WorkflowBooking = { id: string; title: string };
type Item = {
  id?: string; kind: Kind; title: string; booking_id: string | null; booking_name?: string;
  status: string; amount: number | null; due_at: string | null; notes: string | null; updated_at?: string;
};
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function BookingWorkflow({ supabase, booking, canCreate, canEdit, clearBooking }: {
  supabase: SupabaseClient; booking: WorkflowBooking | null; canCreate: boolean; canEdit: boolean; clearBooking: () => void;
}) {
  const [rows, setRows] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [version, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState<Item | null>(null);
  const bookingId = booking?.id ?? null;

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const result = await mprInvoke<{ data: Item[]; has_more: boolean }>(supabase, "mpr-api", {
          action: "list-booking-workflow", booking_id: bookingId, kind: kind || null, query, page,
        });
        if (live) { setRows(result.data); setMore(result.has_more); }
      } catch (e: any) {
        if (live) setError(e.message ?? "Unable to load workflow records.");
      } finally {
        if (live) setBusy(false);
      }
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [supabase, bookingId, kind, query, page, version]);

  function open(item: Item) {
    setSaveError("");
    setForm(item);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await mprInvoke(supabase, "mpr-api", { ...form, action: "save-booking-workflow" });
      setForm(null);
      refresh(current => current + 1);
    } catch (e: any) {
      setSaveError(e.message ?? "Unable to save the workflow record.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="master-module">
    {booking && <div className="notice"><b>{booking.title}</b>
      <button type="button" onClick={() => { setPage(0); clearBooking(); }}>Show all workflow records</button>
    </div>}
    <div className="master-toolbar">
      <div className="master-search"><input aria-label="Search workflow records" value={query}
        onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Search workflow records" /></div>
      <label>Type <select value={kind} onChange={e => { setKind(e.target.value as Kind | ""); setPage(0); }}>
        <option value="">All types</option>
        {Object.entries(kinds).map(([code, item]) => <option key={code} value={code}>{item.label}</option>)}
      </select></label>
      {canCreate && <button type="button" className="outline-btn" onClick={() => open({
        kind: "inquiry", title: "", booking_id: bookingId, status: "new", amount: null, due_at: null, notes: "",
      })}><Plus size={16} /> Add workflow record</button>}
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="master-table-wrap">
      <table className="master-table">
        <thead><tr><th>Title</th><th>Type</th><th>Booking</th><th>Status</th><th>Amount</th><th>Due date</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.id}>
          <td><strong>{item.title}</strong>{item.notes && <p>{item.notes}</p>}</td>
          <td>{kinds[item.kind].label}</td><td>{item.booking_name ?? "—"}</td>
          <td>{item.kind === "reminder" && item.status === "scheduled" && item.due_at && Date.parse(item.due_at) < Date.now()
            ? "Overdue" : label(item.status)}</td>
          <td>{item.amount === null ? "—" : currency.format(item.amount)}</td>
          <td>{item.due_at ? new Date(item.due_at).toLocaleString("en-IN") : "—"}</td>
          <td>{canEdit && <button type="button" className="icon-btn" aria-label={`Edit ${item.title}`} onClick={() => open(item)}><Pencil size={15}/></button>}</td>
        </tr>)}
        {!busy && !rows.length && <tr><td colSpan={7} className="master-empty">No workflow records found.</td></tr>}</tbody>
      </table>
      {busy && <div className="master-loading">Loading workflow records…</div>}
    </div>
    <div className="toolbar-actions" aria-label="Workflow pages">
      <button type="button" className="outline-btn" onClick={() => setPage(page - 1)} disabled={busy || !page}>Previous</button>
      <span aria-live="polite">Page {page + 1}</span>
      <button type="button" className="outline-btn" onClick={() => setPage(page + 1)} disabled={busy || !more}>Next</button>
    </div>
    {form && <div className="master-modal-backdrop">
      <form className="master-modal" onSubmit={save} aria-label="Booking workflow record">
        <div className="master-modal-head"><h2>{form.id ? "Edit workflow record" : "Add workflow record"}</h2></div>
        <div className="master-form-grid">
          <label>Type<select value={form.kind} disabled={!!form.id} onChange={e => {
            const next = e.target.value as Kind;
            setForm({ ...form, kind: next, status: kinds[next].statuses[0], amount: null, due_at: null });
          }}>{Object.entries(kinds).map(([code, item]) => <option key={code} value={code}
            disabled={!form.booking_id && ["deposit", "instructions"].includes(code)}>{item.label}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {kinds[form.kind].statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}
          </select></label>
          <label className="wide">Title<input required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label>
          {["quote", "deposit"].includes(form.kind) && <label>Amount (INR)<input type="number" required min="0" max="999999999999.99"
            step="0.01" value={form.amount ?? ""} onChange={e => setForm({ ...form, amount: e.target.value ? Number(e.target.value) : null })}/></label>}
          {form.kind === "reminder" && <label>Due date and time (local)<input type="datetime-local" required
            value={form.due_at ? localDateTime(form.due_at) : ""}
            onChange={e => setForm({ ...form, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })}/></label>}
          <label className="wide">{form.kind === "instructions" ? "Instructions" : "Notes"}
            <textarea rows={4} maxLength={4000} value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })}/>
          </label>
        </div>
        {saveError && <div className="error-box" role="alert">{saveError}</div>}
        <div className="master-modal-footer">
          <button type="button" className="outline-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
          <button className="primary-btn" disabled={saving}>{saving ? "Saving…" : "Save record"}</button>
        </div>
      </form>
    </div>}
  </div>;
}
