import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Plus, Search, RefreshCw, Pencil, X, Save, Ban
} from "lucide-react";
import { mprInvoke } from "../lib/mprAuth";

type Permission = { module: string; action: string };

type Customer = {
  id: string;
  customer_name: string;
  mobile: string | null;
  email: string | null;
};

type Venue = {
  id: string;
  venue_name: string;
  timezone: string;
};

type EntryStatus = "pending" | "confirmed" | "blocked";

type Booking = {
  id: string;
  venue_id: string;
  customer_id: string | null;
  event_name: string;
  event_type_code: string | null;
  booking_source_code: string | null;
  entry_type: "reserved" | "blocked";
  booking_mode: "full_day" | "time_slot";
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_status: "pending" | "confirmed" | null;
  block_reason_code: string | null;
  status: string;
  notes: string | null;
  timezone: string;
  customer_name?: string;
  venue_name?: string;
};

type Draft = {
  id?: string;
  venue_id: string;
  customer_id: string;
  event_name: string;
  event_type_code: string;
  booking_source_code: string;
  booking_mode: "full_day" | "time_slot";
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  booking_status: EntryStatus;
  block_reason_code: string;
  notes: string;
};

type Props = {
  supabase: SupabaseClient;
  permissions: Permission[];
  role: string;
};

const blank = (): Draft => ({
  venue_id: "",
  customer_id: "",
  event_name: "",
  event_type_code: "",
  booking_source_code: "",
  booking_mode: "full_day",
  start_date: "",
  end_date: "",
  start_time: "",
  end_time: "",
  booking_status: "pending",
  block_reason_code: "",
  notes: ""
});

const today = () =>
  new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata"
  });

export function BookingManager({
  supabase,
  permissions,
  role
}: Props) {
  const can = (action: string) =>
    role === "admin" ||
    permissions.some(
      p => p.module === "bookings" && p.action === action
    );

  const [rows, setRows] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      const [b, c, v] = await Promise.all([
        mprInvoke<{ data: Booking[] }>(
          supabase,
          "mpr-api",
          { action: "list-bookings" }
        ),
        mprInvoke<{ data: Customer[] }>(
          supabase,
          "mpr-api",
          { action: "list-booking-customers" }
        ),
        mprInvoke<{ data: Venue[] }>(
          supabase,
          "mpr-api",
          { action: "get-active-venues" }
        )
      ]);

      const customerMap = new Map(
        (c.data ?? []).map(x => [x.id, x.customer_name])
      );

      const venueMap = new Map(
        (v.data ?? []).map(x => [x.id, x.venue_name])
      );

      setCustomers(c.data ?? []);
      setVenues(v.data ?? []);

      setRows(
        (b.data ?? []).map(x => ({
          ...x,
          customer_name: x.customer_id
            ? customerMap.get(x.customer_id) ?? "Unknown customer"
            : "—",
          venue_name: venueMap.get(x.venue_id) ?? "Unknown venue"
        }))
      );
    } catch (e: any) {
      setError(e.message ?? "Unable to load bookings.");
    } finally {
      setBusy(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return q
      ? rows.filter(x =>
          [
            x.event_name,
            x.customer_name,
            x.venue_name,
            x.booking_status,
            x.entry_type === "blocked" ? "blocked" : "",
            x.block_reason_code,
            x.start_date
          ].some(v => String(v ?? "").toLowerCase().includes(q))
        )
      : rows;
  }, [rows, query]);

  const update = (key: keyof Draft, value: string) => {
    setDraft(d => (d ? { ...d, [key]: value } : d));
  };

  function edit(row: Booking) {
    setDraft({
      id: row.id,
      venue_id: row.venue_id,
      customer_id: row.customer_id ?? "",
      event_name: row.event_name ?? "",
      event_type_code: row.event_type_code ?? "",
      booking_source_code: row.booking_source_code ?? "",
      booking_mode: row.booking_mode,
      start_date: row.start_date,
      end_date: row.end_date,
      start_time: row.start_time ?? "",
      end_time: row.end_time ?? "",
      booking_status:
        row.entry_type === "blocked"
          ? "blocked"
          : row.booking_status ?? "pending",
      block_reason_code: row.block_reason_code ?? "",
      notes: row.notes ?? ""
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await mprInvoke(supabase, "mpr-api", {
        action: "save-booking",
        ...draft,
        customer_id:
          draft.booking_status === "blocked"
            ? null
            : draft.customer_id || null
      });

      setDraft(null);
      setMessage(
        draft.booking_status === "blocked"
          ? "Blocked period saved successfully."
          : "Booking saved successfully."
      );

      await load();
    } catch (e: any) {
      setError(e.message ?? "Unable to save booking.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(row: Booking) {
    const description =
      row.entry_type === "blocked" ? "blocked period" : "booking";

    if (
      !window.confirm(
        `Cancel ${description} for ${row.event_name}? It will remain in history.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await mprInvoke(supabase, "mpr-api", {
        action: "cancel-booking",
        id: row.id
      });

      setMessage("Entry cancelled.");
      await load();
    } catch (e: any) {
      setError(e.message ?? "Unable to cancel entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="master-module">
      <div className="master-toolbar">
        <div className="master-search">
          <Search size={17} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search event, customer, venue or status…"
          />
        </div>

        <div className="master-actions">
          <button
            className="outline-btn"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>

          {can("create") && (
            <button
              className="primary-btn"
              onClick={() =>
                setDraft({
                  ...blank(),
                  start_date: today(),
                  end_date: today()
                })
              }
            >
              <Plus size={16} /> New booking / block
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-box master-message">{error}</div>
      )}

      {message && (
        <div className="notice master-message">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}

      <div className="master-table-wrap">
        <table className="master-table">
          <thead>
            <tr>
              <th>Event / Block</th>
              <th>Customer</th>
              <th>Venue</th>
              <th>Dates / Time</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(r => {
              const displayStatus =
                r.status !== "active"
                  ? "Cancelled"
                  : r.entry_type === "blocked"
                    ? "Blocked"
                    : r.booking_status ?? "Pending";

              const statusClass =
                r.status !== "active"
                  ? "inactive"
                  : r.entry_type === "blocked"
                    ? "blocked"
                    : r.booking_status === "confirmed"
                      ? "active"
                      : "pending";

              return (
                <tr key={r.id}>
                  <td>
                    <b>{r.event_name || r.block_reason_code || "Calendar entry"}</b>
                    {r.entry_type === "blocked" && r.block_reason_code && (
                      <div className="muted">
                        {r.block_reason_code}
                      </div>
                    )}
                  </td>

                  <td>{r.customer_name ?? "—"}</td>
                  <td>{r.venue_name}</td>

                  <td>
                    {r.start_date}
                    {r.end_date !== r.start_date
                      ? ` – ${r.end_date}`
                      : ""}
                    {r.booking_mode === "time_slot"
                      ? ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`
                      : ""}
                  </td>

                  <td>
                    {r.booking_mode === "full_day"
                      ? "Full day"
                      : "Time slot"}
                  </td>

                  <td>
                    <span className={`master-status ${statusClass}`}>
                      {displayStatus}
                    </span>
                  </td>

                  <td>
                    <div className="master-row-actions">
                      {can("edit") && r.status === "active" && (
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => edit(r)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}

                      {can("delete") && r.status === "active" && (
                        <button
                          className="icon-btn danger"
                          title="Cancel entry"
                          onClick={() => void cancel(r)}
                        >
                          <Ban size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {!busy && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="master-empty">
                  No bookings or blocked periods found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {busy && <div className="master-loading">Working…</div>}
      </div>

      {draft && (
        <div
          className="master-modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <form className="master-modal" onSubmit={save}>
            <div className="master-modal-head">
              <div>
                <span className="eyebrow">
                  {draft.id ? "UPDATE CALENDAR ENTRY" : "NEW CALENDAR ENTRY"}
                </span>
                <h2>
                  {draft.id
                    ? "Edit booking / block"
                    : "Create booking / block"}
                </h2>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => setDraft(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="master-form-grid">
              <label>
                Entry status *
                <select
                  value={draft.booking_status}
                  onChange={e => {
                    const status = e.target.value as EntryStatus;
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            booking_status: status,
                            customer_id:
                              status === "blocked" ? "" : d.customer_id
                          }
                        : d
                    );
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="blocked">Blocked</option>
                </select>
              </label>

              <label>
                Event / block name *
                <input
                  required
                  maxLength={200}
                  value={draft.event_name}
                  onChange={e => update("event_name", e.target.value)}
                  placeholder="e.g. Wedding reception / Hall renovation"
                />
              </label>

              {draft.booking_status !== "blocked" && (
                <label>
                  Customer *
                  <select
                    required
                    value={draft.customer_id}
                    onChange={e => update("customer_id", e.target.value)}
                  >
                    <option value="">Select customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.customer_name}
                        {c.mobile ? ` · ${c.mobile}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {draft.booking_status === "blocked" && (
                <label>
                  Block reason code *
                  <input
                    required
                    maxLength={100}
                    value={draft.block_reason_code}
                    onChange={e =>
                      update("block_reason_code", e.target.value)
                    }
                    placeholder="e.g. maintenance, renovation, internal_use"
                  />
                </label>
              )}

              <label>
                Venue *
                <select
                  required
                  value={draft.venue_id}
                  onChange={e => update("venue_id", e.target.value)}
                >
                  <option value="">Select venue</option>
                  {venues.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.venue_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Booking mode *
                <select
                  value={draft.booking_mode}
                  onChange={e => {
                    const mode = e.target.value as Draft["booking_mode"];
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            booking_mode: mode,
                            start_time: "",
                            end_time: "",
                            end_date:
                              mode === "time_slot"
                                ? d.start_date
                                : d.end_date
                          }
                        : d
                    );
                  }}
                >
                  <option value="full_day">Full day</option>
                  <option value="time_slot">Time slot (same day)</option>
                </select>
              </label>

              <label>
                Start date *
                <input
                  type="date"
                  required
                  value={draft.start_date}
                  onChange={e =>
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            start_date: e.target.value,
                            ...(d.booking_mode === "time_slot"
                              ? { end_date: e.target.value }
                              : {})
                          }
                        : d
                    )
                  }
                />
              </label>

              <label>
                End date *
                <input
                  type="date"
                  required
                  min={draft.start_date}
                  disabled={draft.booking_mode === "time_slot"}
                  value={draft.end_date}
                  onChange={e => update("end_date", e.target.value)}
                />
              </label>

              {draft.booking_mode === "time_slot" && (
                <>
                  <label>
                    Start time *
                    <input
                      type="time"
                      required
                      value={draft.start_time}
                      onChange={e => update("start_time", e.target.value)}
                    />
                  </label>

                  <label>
                    End time *
                    <input
                      type="time"
                      required
                      value={draft.end_time}
                      onChange={e => update("end_time", e.target.value)}
                    />
                  </label>
                </>
              )}

              <label>
                Event type code
                <input
                  value={draft.event_type_code}
                  onChange={e => update("event_type_code", e.target.value)}
                  placeholder="Optional configuration code"
                />
              </label>

              <label>
                Booking source code
                <input
                  value={draft.booking_source_code}
                  onChange={e =>
                    update("booking_source_code", e.target.value)
                  }
                  placeholder="Optional source code"
                />
              </label>

              <label className="wide">
                Notes
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={e => update("notes", e.target.value)}
                />
              </label>
            </div>

            <p className="muted" style={{ fontSize: 12 }}>
              The database checks availability and prevents overlapping
              active reservations and blocked periods for the same venue.
            </p>

            {error && <div className="error-box">{error}</div>}

            <div className="master-modal-footer">
              <button
                type="button"
                className="outline-btn"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={
                  busy ||
                  venues.length === 0 ||
                  (draft.booking_status !== "blocked" &&
                    customers.length === 0)
                }
              >
                <Save size={16} />
                {busy ? "Saving…" : "Save entry"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}