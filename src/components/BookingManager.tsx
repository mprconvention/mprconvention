import {
  bookingBehaviors, bookingEndDate, bookingModeForSchedule,
  bookingTimeRange, getBookingSchedule, halfDayTimes, type BookingMode,
} from "../lib/bookingPicklists";
import { getLovLabels, getLovValues, type LovOption } from "../lib/mprCalendars";
import { BookingDetails } from "./BookingDetails";
import type { WorkflowBooking } from "./BookingWorkflow";
import { PicklistSelect } from "./PicklistSelect";
import { AuditCells, AuditHeaders } from "./RecordAudit";
import type { RecordAudit } from "../lib/recordAudit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Plus, Search, RefreshCw, Pencil, X, Save, Ban, Eye, ListChecks
} from "lucide-react";
import { mprInvoke } from "../lib/mprAuth";

type Permission = { module: string; action: string };

type Customer = {
  id: string;
  customer_name: string;
  mobile?: string | null;
  email?: string | null;
};

type Venue = {
  id: string;
  venue_name: string;
  timezone: string;
};

type EntryStatus = "pending" | "confirmed" | "blocked";

type Booking = RecordAudit & {
  id: string;
  revision: number;
  hold_expires_at: string | null;
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
  revision?: number;
  hold_expires_at?: string | null;
  hold_minutes?: string;
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
  onWorkflow?: (booking: WorkflowBooking) => void;
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

const blankCustomer = () => ({ customer_name: "", mobile: "", email: "", customer_category_code: "" });

function statusCode(row: Booking) {
  return row.entry_status_code ?? (row.entry_type === "blocked" ? "blocked" : row.booking_status ?? "pending");
}

function holdExpired(row: Booking) {
  return !!row.hold_expires_at && Date.parse(row.hold_expires_at) <= Date.now();
}

function statusLabel(row: Booking, options: LovOption[]) {
  if (holdExpired(row)) return "Expired";
  if (row.status !== "active") return "Cancelled";
  if (row.hold_expires_at) return "On hold";
  return optionLabel(options, statusCode(row), "entry_statuses");
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
  role,
  onWorkflow
}: Props) {
  const can = (action: string, type: "reserved" | "blocked") =>
    role === "admin" || (role !== "viewer" && permissions.some(
      p => p.module === (type === "blocked" ? "calendar_blocks" : "bookings") && p.action === action
    ));

  const canCreate = can("create", "reserved") || can("create", "blocked");
  const canCreateCustomer = role === "admin" || (role !== "viewer" &&
    permissions.some(p => p.module === "customers" && p.action === "create"));

  const [entryStatuses, setEntryStatuses] = useState<LovOption[]>([]);
  const [bookingModes, setBookingModes] = useState<LovOption[]>([]);
  const [eventTypeLabels, setEventTypeLabels] = useState<Map<string, string>>(new Map());
  const [bookingSourceLabels, setBookingSourceLabels] = useState<Map<string, string>>(new Map());
  const [blockReasonLabels, setBlockReasonLabels] = useState<Map<string, string>>(new Map());
  const [picklistError, setPicklistError] = useState("");
  const [rows, setRows] = useState<Booking[]>([]);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const details = rows.find(row => row.id === detailsId);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerDraft, setCustomerDraft] = useState<ReturnType<typeof blankCustomer> | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerCreateError, setCustomerCreateError] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const customerEmail = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const loadVersion = useRef(0);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftMode = bookingModes.find(option => option.value_code === draft?.booking_mode_code);
  const schedule = getBookingSchedule(draftMode?.extra_data?.behavior, draft?.booking_mode_code, draft?.booking_mode ?? "full_day");
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

  const original = rows.find(row => row.id === draft?.id);
  const statusOptions = entryStatuses.filter(option => {
    const type = option.extra_data?.behavior === "blocked" ? "blocked" : "reserved";
    if (!draft?.id) return can("create", type);
    if (!can("edit", type)) return false;
    return type === original?.entry_type || (!!original && can("delete", original.entry_type) && can("create", type));
  });
  const defaultStatus = statusOptions.find(option => isActiveOption(option, "entry_statuses") && option.value_code === "pending")
    ?? statusOptions.find(option => isActiveOption(option, "entry_statuses"));
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
    const version = ++loadVersion.current;
    setBusy(true);
    setError("");
    try {
      const result = await mprInvoke<{ data: Booking[]; has_more: boolean }>(
        supabase, "mpr-api", { action: "list-bookings", query, page }
      );
      if (version !== loadVersion.current) return;
      setRows(result.data);
      setHasMore(result.has_more);
      if (page > 0 && !result.data.length) setPage(page - 1);
    } catch (e: any) {
      if (version === loadVersion.current) setError(e.message ?? "Unable to load bookings.");
    } finally {
      if (version === loadVersion.current) setBusy(false);
    }
  }, [supabase, query, page]);

  const loadVenues = useCallback(async () => {
    try {
      const result = await mprInvoke<{ data: Venue[] }>(supabase, "mpr-api", { action: "get-active-venues" });
      setVenues(result.data);
    } catch (e: any) {
      setError(e.message ?? "Unable to load venues.");
    }
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => { window.clearTimeout(timer); loadVersion.current++; };
  }, [load, query]);

  useEffect(() => {
    void loadPicklists();
    void loadFieldLabels();
    void loadVenues();
  }, [loadPicklists, loadFieldLabels, loadVenues]);

  const needsCustomer = !!draft && draft.booking_status !== "blocked";
  const selectedCustomer = draft?.customer_id;
  useEffect(() => {
    if (!needsCustomer || !customerQuery.trim()) {
      setCustomers([]);
      setCustomerError("");
      setCustomerSearching(false);
      return;
    }
    let current = true;
    setCustomers([]);
    setCustomerError("");
    setCustomerSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await mprInvoke<{ data: Customer[] }>(supabase, "mpr-api", {
          action: "list-booking-customers", query: customerQuery,
        });
        if (current) { setCustomers(result.data); setCustomerError(""); }
      } catch (e: any) {
        if (current) setCustomerError(e.message ?? "Unable to find customers.");
      } finally {
        if (current) setCustomerSearching(false);
      }
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [supabase, needsCustomer, customerQuery]);

  const update = (key: keyof Draft, value: string) => {
    setDraft(d => (d ? { ...d, [key]: value } : d));
  };

  function edit(row: Booking) {
    setWriteError("");
    setCustomerQuery("");
    setCustomerName(row.customer_name ?? "");
    setCustomerDraft(null);
    setDraft({
      id: row.id,
      revision: row.revision,
      hold_expires_at: row.hold_expires_at,
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

  function selectCustomer(customer: Customer) {
    update("customer_id", customer.id);
    setCustomerName(customer.customer_name);
    setCustomerQuery("");
  }

  async function createCustomer() {
    if (!customerDraft || customerSaving) return;
    const name = customerDraft.customer_name.trim();
    if (!name) {
      setCustomerCreateError("Enter a customer name.");
      return;
    }
    if (!customerEmail.current?.reportValidity()) return;
    setCustomerSaving(true);
    setCustomerCreateError("");
    try {
      const { data } = await mprInvoke<{ data: { id: string } }>(supabase, "mpr-api", {
        action: "save-customer", ...customerDraft,
      });
      selectCustomer({ id: data.id, customer_name: name });
      setCustomerDraft(null);
    } catch (e: any) {
      setCustomerCreateError(e.message ?? "Unable to create customer.");
    } finally {
      setCustomerSaving(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || saving || customerSaving || customerDraft) return;
    if (draft.booking_status !== "blocked" && !draft.customer_id) {
      setWriteError("Search for an existing customer or create one before saving the booking.");
      return;
    }

    setSaving(true);
    setWriteError("");
    setMessage("");

    try {
      await mprInvoke(supabase, "mpr-api", {
        action: "save-booking",
        ...draft,
        hold_minutes: draft.booking_status === "pending" && draft.hold_minutes !== undefined
          ? (draft.hold_minutes ? Number(draft.hold_minutes) : null) : undefined,
        ...(halfDayTimes[schedule] ? { start_time: null, end_time: null } : {}),
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
      setWriteError(e.message ?? "Unable to save booking.");
    } finally {
      setSaving(false);
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

    setSaving(true);
    setWriteError("");
    setMessage("");

    try {
      await mprInvoke(supabase, "mpr-api", {
        action: "cancel-booking",
        id: row.id,
        revision: row.revision
      });

      setMessage("Entry cancelled.");
      await load();
    } catch (e: any) {
      setWriteError(e.message ?? "Unable to cancel entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="master-module">
      <div className="master-toolbar">
        <div className="master-search">
          <Search size={17} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search event, customer, venue or status…"
          />
        </div>

        <div className="master-actions">
          <button
            className="outline-btn"
            onClick={() => { void load(); void loadPicklists(); void loadFieldLabels(); void loadVenues(); }}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>

          {canCreate && (
            <button
              className="primary-btn"
              disabled={saving || !defaultStatus || !defaultMode}
              onClick={() => {
                if (!defaultStatus || !defaultMode) return;
                setWriteError("");
                setCustomerQuery("");
                setCustomerName("");
                setCustomerDraft(null);
                const date = today();
                const defaultSchedule = getBookingSchedule(defaultMode.extra_data?.behavior, defaultMode.value_code, "full_day");
                setDraft({
                  ...blank(),
                  booking_status: defaultStatus.extra_data?.behavior as EntryStatus,
                  entry_status_code: defaultStatus.value_code,
                  booking_mode: bookingModeForSchedule(defaultSchedule),
                  booking_mode_code: defaultMode.value_code,
                  start_date: date,
                  end_date: bookingEndDate(defaultSchedule, date, date),
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

      {!draft && writeError && <div className="error-box master-message" role="alert">{writeError}</div>}

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
            {rows.map(r => {
              const editable = r.status === "active" && !holdExpired(r);

              const statusClass =
                !editable
                  ? "inactive"
                  : r.entry_type === "blocked"
                    ? "blocked"
                    : r.booking_status === "confirmed"
                      ? "active"
                      : "pending";

              return (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="booking-detail-link" onClick={() => setDetailsId(r.id)}
                      aria-label={`View booking details for ${r.event_name || r.block_reason_code || "calendar entry"}`}>
                      <Eye size={15} aria-hidden="true"/>
                      {r.event_name || r.block_reason_code || "Calendar entry"}
                    </button>
                  </td>

                  <td>{r.customer_name ?? "—"}</td>
                  <td>{r.venue_name}</td>

                  <td>
                    {r.start_date}
                    {r.end_date !== r.start_date
                      ? ` – ${r.end_date}`
                      : ""}
                    {r.booking_mode === "time_slot" && <> · {bookingTimeRange(r.start_time, r.end_time)}</>}
                  </td>

                  <td>
                    {optionLabel(bookingModes, r.booking_mode_code ?? r.booking_mode, "booking_modes")}
                  </td>

                  <td>
                    <span className={`master-status ${statusClass}`}>
                      {statusLabel(r, entryStatuses)}
                    </span>
                  </td>

                  <td>{eventTypeLabels.get(r.event_type_code ?? "") ?? r.event_type_code ?? "—"}</td>
                  <td>{bookingSourceLabels.get(r.booking_source_code ?? "") ?? r.booking_source_code ?? "—"}</td>
                  <td>{blockReasonLabels.get(r.block_reason_code ?? "") ?? r.block_reason_code ?? "—"}</td>
                  <AuditCells record={r}/>
                  <td>
                    <div className="master-row-actions">
                      {onWorkflow && r.entry_type === "reserved" && (
                        <button type="button" className="icon-btn" title="Booking workflow"
                          onClick={() => onWorkflow({ id: r.id, title: r.event_name || "Reservation" })}>
                          <ListChecks size={15}/>
                        </button>
                      )}
                      {can("edit", r.entry_type) && editable && (
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => edit(r)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}

                      {can("delete", r.entry_type) && editable && (
                        <button
                          className="icon-btn danger"
                          title="Cancel entry"
                          disabled={saving}
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

            {!busy && rows.length === 0 && (
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

      <div className="toolbar-actions" aria-label="Booking pages">
        <button className="outline-btn" type="button" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span aria-live="polite">Page {page + 1}</span>
        <button className="outline-btn" type="button" disabled={busy || !hasMore} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {details && (
        <BookingDetails
          title={details.event_name || (details.entry_type === "blocked" ? "Blocked period" : "Booking details")}
          fields={[
            ["Entry type", details.entry_type === "blocked" ? "Venue block" : "Reservation"],
            ["Entry status", statusLabel(details, entryStatuses)],
            ["Venue", details.venue_name ?? "—"],
            ["Booking mode", optionLabel(bookingModes, details.booking_mode_code ?? details.booking_mode, "booking_modes")],
            ["Start date", details.start_date],
            ["End date", details.end_date],
            ["Time", details.booking_mode === "full_day"
              ? "All day" : bookingTimeRange(details.start_time, details.end_time) || "—"],
            ["Venue time zone", details.timezone],
            ...(details.entry_type === "blocked"
              ? [["Block reason", blockReasonLabels.get(details.block_reason_code ?? "") ?? details.block_reason_code ?? "—"]]
              : [
                  ["Customer", details.customer_name ?? "—"],
                  ["Event type", eventTypeLabels.get(details.event_type_code ?? "") ?? details.event_type_code ?? "—"],
                  ["Booking source", bookingSourceLabels.get(details.booking_source_code ?? "") ?? details.booking_source_code ?? "—"],
                ]) as [string, string][],
          ]}
          notes={details.notes}
          audit={details}
          onClose={() => setDetailsId(null)}
        />
      )}

      {draft && (
        <div
          className="master-modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !customerSaving && !saving) setDraft(null);
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
                disabled={customerSaving || saving}
                onClick={() => setDraft(null)}
              >
                <X size={18} />
              </button>
            </div>

            {writeError && <div className="error-box" role="alert">{writeError}</div>}
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
                  disabled={customerSaving || !!customerDraft}
                >
                  <WorkflowOptions options={statusOptions} value={draft.entry_status_code} listCode="entry_statuses"/>
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

              {needsCustomer && <div className="booking-customer-search">
                {selectedCustomer && <div className="toolbar-actions">
                  <strong>Customer: {customerName}</strong>
                  <button type="button" className="outline-btn" onClick={() => update("customer_id", "")}
                    disabled={customerSaving}>Change customer</button>
                </div>}
                {!selectedCustomer && !customerDraft && <>
                  <label>
                    Customer *
                    <input value={customerQuery} onChange={e => setCustomerQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}
                      placeholder="Search customer records" maxLength={150} autoComplete="off" />
                  </label>
                  {customerSearching && <p role="status">Searching customers…</p>}
                  {customerError && <p role="alert">{customerError}</p>}
                  {customerQuery.trim() && !customerSearching && !customerError && customers.length === 0 &&
                    <p role="status">No matching customers.</p>}
                  {customers.length > 0 && <ul className="booking-customer-results" aria-label="Matching customers">
                    {customers.map(customer => <li key={customer.id}>
                      <button type="button" className="outline-btn" onClick={() => selectCustomer(customer)}>
                        <b>{customer.customer_name}</b>
                        {(customer.mobile || customer.email) && <span>{[customer.mobile, customer.email].filter(Boolean).join(" · ")}</span>}
                      </button>
                    </li>)}
                  </ul>}
                  {canCreateCustomer && <button type="button" className="outline-btn" onClick={() => {
                    setCustomerCreateError("");
                    setCustomerDraft({ ...blankCustomer(), customer_name: customerQuery.trim() });
                  }}><Plus size={15} /> Create customer</button>}
                </>}
                {customerDraft && <fieldset className="booking-new-customer" disabled={customerSaving}
                  onKeyDown={e => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
                  <legend>New customer</legend>
                  <label>Customer name *<input value={customerDraft.customer_name} maxLength={200}
                    onChange={e => setCustomerDraft({ ...customerDraft, customer_name: e.target.value })} /></label>
                  <label>Mobile<input type="tel" value={customerDraft.mobile} maxLength={40}
                    onChange={e => setCustomerDraft({ ...customerDraft, mobile: e.target.value })} /></label>
                  <label>Email<input ref={customerEmail} type="email" value={customerDraft.email} maxLength={254}
                    onChange={e => setCustomerDraft({ ...customerDraft, email: e.target.value })} /></label>
                  <label>Customer category<PicklistSelect supabase={supabase} listCode="customer_categories"
                    value={customerDraft.customer_category_code}
                    onChange={value => setCustomerDraft({ ...customerDraft, customer_category_code: value })} /></label>
                  {customerCreateError && <p role="alert">{customerCreateError}</p>}
                  <div className="toolbar-actions">
                    <button type="button" className="outline-btn" onClick={() => setCustomerDraft(null)}>Cancel</button>
                    <button type="button" className="primary-small" onClick={() => void createCustomer()}>Create and select</button>
                  </div>
                </fieldset>}
              </div>}

              {draft.booking_status === "pending" && (
                <label>
                  Temporary hold
                  <select value={draft.hold_minutes ?? (draft.hold_expires_at ? "keep" : "")}
                    onChange={e => setDraft({ ...draft, hold_minutes: e.target.value === "keep" ? undefined : e.target.value })}>
                    {draft.hold_expires_at && <option value="keep">Keep current expiry</option>}
                    <option value="">No expiry</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="240">4 hours</option>
                    <option value="1440">24 hours</option>
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
                  {draft.venue_id && !venues.some(v => v.id === draft.venue_id) && (
                    <option value={draft.venue_id} disabled>{original?.venue_name ?? "Unavailable venue"}</option>
                  )}
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
                    const option = bookingModes.find(option => option.value_code === code);
                    if (!option) return;
                    const nextSchedule = getBookingSchedule(option.extra_data?.behavior, code, "full_day");
                    const mode = bookingModeForSchedule(nextSchedule);
                    setDraft(d =>
                      d
                        ? {
                            ...d,
                            booking_mode: mode,
                            booking_mode_code: code,
                            start_time: nextSchedule === "time_slot" && schedule === "time_slot" ? d.start_time : "",
                            end_time: nextSchedule === "time_slot" && schedule === "time_slot" ? d.end_time : "",
                            end_date: bookingEndDate(nextSchedule, d.start_date, d.end_date)
                          }
                        : d
                    );
                  }}
                >
                  <WorkflowOptions options={bookingModes} value={draft.booking_mode_code} listCode="booking_modes"/>
                </select>
              </label>

              <label>
                {draft.booking_mode === "time_slot" ? "Date *" : "Start date *"}
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
                            end_date: bookingEndDate(schedule, e.target.value, d.end_date)
                          }
                        : d
                    )
                  }
                />
              </label>

              {draft.booking_mode === "full_day" && (
                <label>
                  End date (inclusive) *
                  <input
                    type="date"
                    required
                    min={bookingEndDate(schedule, draft.start_date, "")}
                    value={draft.end_date}
                    onChange={e => update("end_date", e.target.value)}
                  />
                </label>
              )}

              {halfDayTimes[schedule] && (
                <div className="muted booking-period">
                  <strong>{halfDayTimes[schedule]}</strong>
                  <span>Venue local time</span>
                </div>
              )}

              {schedule === "time_slot" && (
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
                disabled={customerSaving || saving}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={
                  busy || saving || customerSaving || !!customerDraft || venues.length === 0
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
