import { bookingBehaviors } from "../lib/bookingPicklists";
import { getLovLabels, getLovValues, type LovOption } from "../lib/mprCalendars";
import { PicklistSelect } from "./PicklistSelect";
import { AuditCells, AuditHeaders } from "./RecordAudit";
import type { RecordAudit } from "../lib/recordAudit";
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
type BookingMode = "full_day" | "time_slot";

type Booking = RecordAudit & {
  id: string;
  venue_id: string;
  customer_id: string | null;
  event_name: string;
  event_type_code: string | null;
  booking_source_code: string | null;
  entry_type: "reserved" | "blocked";
  booking_mode: BookingMode;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_status: "pending" | "confirmed" | null;
  entry_status_code?: string | null;
  booking_mode_code?: string | null;
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
  booking_mode: BookingMode;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  booking_status: EntryStatus;
  entry_status_code: string;
  booking_mode_code: string;
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
  entry_status_code: "pending",
  booking_mode_code: "full_day",
  block_reason_code: "",
  notes: ""
});

function statusCode(row: Booking) {
  return row.entry_status_code ?? (row.entry_type === "blocked" ? "blocked" : row.booking_status ?? "pending");
}

function optionLabel(options: LovOption[], code: string, listCode: string) {
  return options.find(option => option.value_code === code)?.display_label
    ?? bookingBehaviors[listCode][code]
    ?? code;
}

function isActiveOption(option: LovOption, listCode: string) {
  return option.is_active && Object.hasOwn(bookingBehaviors[listCode], option.extra_data?.behavior ?? "");
}

function WorkflowOptions({ options, value, listCode }: { options: LovOption[]; value: string; listCode: string }) {
  const active = options.filter(option => isActiveOption(option, listCode));
  return <>
    {value && !active.some(option => option.value_code === value) && (
      <option value={value}>{optionLabel(options, value, listCode)} (saved value)</option>
    )}
    {active.map(option => <option key={option.value_code} value={option.value_code}>{option.display_label}</option>)}
  </>;
}

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

  const [entryStatuses, setEntryStatuses] = useState<LovOption[]>([]);
  const [bookingModes, setBookingModes] = useState<LovOption[]>([]);
  const [eventTypeLabels, setEventTypeLabels] = useState<Map<string, string>>(new Map());
  const [bookingSourceLabels, setBookingSourceLabels] = useState<Map<string, string>>(new Map());
  const [blockReasonLabels, setBlockReasonLabels] = useState<Map<string, string>>(new Map());
  const [picklistError, setPicklistError] = useState("");
  const [rows, setRows] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPicklists = useCallback(async () => {
    setPicklistError("");
    try {
      const [statuses, modes] = await Promise.all([
        getLovValues(supabase, "entry_statuses", true),
        getLovValues(supabase, "booking_modes", true),
      ]);
      setEntryStatuses(statuses);
      setBookingModes(modes);
      if (!statuses.some(option => isActiveOption(option, "entry_statuses")) || !modes.some(option => isActiveOption(option, "booking_modes"))) {
        setPicklistError("Enable an entry status and booking mode in Configuration to create an entry.");
      }
    } catch {
      setPicklistError("Could not load booking options. Refresh to retry.");
    }
  }, [supabase]);

  const defaultStatus = entryStatuses.find(option => isActiveOption(option, "entry_statuses") && option.value_code === "pending")
    ?? entryStatuses.find(option => isActiveOption(option, "entry_statuses"));
  const defaultMode = bookingModes.find(option => isActiveOption(option, "booking_modes") && option.value_code === "full_day")
    ?? bookingModes.find(option => isActiveOption(option, "booking_modes"));

  const loadFieldLabels = useCallback(async () => {
    const [types, sources, reasons] = await Promise.allSettled([
      getLovLabels(supabase, "event_types"),
      getLovLabels(supabase, "booking_sources"),
      getLovLabels(supabase, "block_reasons"),
    ]);
    if (types.status === "fulfilled") setEventTypeLabels(types.value);
    if (sources.status === "fulfilled") setBookingSourceLabels(sources.value);
    if (reasons.status === "fulfilled") setBlockReasonLabels(reasons.value);
  }, [supabase]);

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
    void loadPicklists();
    void loadFieldLabels();
  }, [load, loadPicklists, loadFieldLabels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return q
      ? rows.filter(x =>
          [
            x.event_name,
            x.customer_name,
            x.venue_name,
            x.booking_status,
            optionLabel(entryStatuses, statusCode(x), "entry_statuses"),
            optionLabel(bookingModes, x.booking_mode_code ?? x.booking_mode, "booking_modes"),
            x.entry_type === "blocked" ? "blocked" : "",
            x.block_reason_code,
            eventTypeLabels.get(x.event_type_code ?? ""),
            bookingSourceLabels.get(x.booking_source_code ?? ""),
            blockReasonLabels.get(x.block_reason_code ?? ""),
            x.start_date
          ].some(v => String(v ?? "").toLowerCase().includes(q))
        )
      : rows;
  }, [rows, query, entryStatuses, bookingModes, eventTypeLabels, bookingSourceLabels, blockReasonLabels]);

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
      entry_status_code: statusCode(row),
      booking_mode_code: row.booking_mode_code ?? row.booking_mode,
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
            onClick={() => { void load(); void loadPicklists(); void loadFieldLabels(); }}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>

          {can("create") && (
            <button
              className="primary-btn"
              disabled={!defaultStatus || !defaultMode}
              onClick={() => {
                if (!defaultStatus || !defaultMode) return;
                const date = today();
                setDraft({
                  ...blank(),
                  booking_status: defaultStatus.extra_data?.behavior as EntryStatus,
                  entry_status_code: defaultStatus.value_code,
                  booking_mode: defaultMode.extra_data?.behavior as BookingMode,
                  booking_mode_code: defaultMode.value_code,
                  start_date: date,
                  end_date: date,
                });
              }}
            >
              <Plus size={16} /> New booking / block
            </button>
          )}
        </div>
      </div>

      {picklistError && <div className="error-box master-message" role="alert">{picklistError}</div>}
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
              <th>Event type</th>
              <th>Booking source</th>
              <th>Block reason</th>
              <AuditHeaders/>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(r => {
              const displayStatus =
                r.status !== "active"
                  ? "Cancelled"
                  : optionLabel(entryStatuses, statusCode(r), "entry_statuses");

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
                    {optionLabel(bookingModes, r.booking_mode_code ?? r.booking_mode, "booking_modes")}
                  </td>

                  <td>
                    <span className={`master-status ${statusClass}`}>
                      {displayStatus}
                    </span>
                  </td>

                  <td>{eventTypeLabels.get(r.event_type_code ?? "") ?? r.event_type_code ?? "—"}</td>
                  <td>{bookingSourceLabels.get(r.booking_source_code ?? "") ?? r.booking_source_code ?? "—"}</td>
                  <td>{blockReasonLabels.get(r.block_reason_code ?? "") ?? r.block_reason_code ?? "—"}</td>
                  <AuditCells record={r}/>
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
                <td colSpan={14} className="master-empty">
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
                  required
                  value={draft.entry_status_code}
                  onChange={e => {
                    const code = e.target.value;
                    const status = entryStatuses.find(option => option.value_code === code)?.extra_data?.behavior as EntryStatus | undefined;
                    if (!status) return;
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            booking_status: status,
                            entry_status_code: code,
                            customer_id:
                              status === "blocked" ? "" : d.customer_id
                          }
                        : d
                    );
                  }}
                >
                  <WorkflowOptions options={entryStatuses} value={draft.entry_status_code} listCode="entry_statuses"/>
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
                  Block reason *
                  <PicklistSelect
                    supabase={supabase}
                    listCode="block_reasons"
                    required
                    value={draft.block_reason_code}
                    onChange={value => update("block_reason_code", value)}
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
                  required
                  value={draft.booking_mode_code}
                  onChange={e => {
                    const code = e.target.value;
                    const mode = bookingModes.find(option => option.value_code === code)?.extra_data?.behavior as BookingMode | undefined;
                    if (!mode) return;
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            booking_mode: mode,
                            booking_mode_code: code,
                            start_time: mode === d.booking_mode ? d.start_time : "",
                            end_time: mode === d.booking_mode ? d.end_time : "",
                            end_date:
                              mode === "time_slot"
                                ? d.start_date
                                : d.end_date
                          }
                        : d
                    );
                  }}
                >
                  <WorkflowOptions options={bookingModes} value={draft.booking_mode_code} listCode="booking_modes"/>
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

              {draft.booking_status !== "blocked" && <>
                <label>
                  Event type
                  <PicklistSelect
                    supabase={supabase}
                    listCode="event_types"
                    value={draft.event_type_code}
                    onChange={value => update("event_type_code", value)}
                  />
                </label>
                <label>
                  Booking source
                  <PicklistSelect
                    supabase={supabase}
                    listCode="booking_sources"
                    value={draft.booking_source_code}
                    onChange={value => update("booking_source_code", value)}
                  />
                </label>
              </>}

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