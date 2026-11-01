import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getThreeCalendars,
  getActiveVenues,
  type CalendarEntry,
  type AuspiciousDate,
} from "../lib/mprCalendars";

type Venue = { id: string; venue_name: string; timezone: string };

export function MprCalendars({ supabase }: { supabase: SupabaseClient }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reserved, setReserved] = useState<CalendarEntry[]>([]);
  const [blocked, setBlocked] = useState<CalendarEntry[]>([]);
  const [auspicious, setAuspicious] = useState<AuspiciousDate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getActiveVenues(supabase)
      .then((rows) => {
        setVenues(rows as Venue[]);
        if (rows.length) setVenueId(rows[0].id);
      })
      .catch((e) => setError(e.message));
  }, [supabase]);

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    getThreeCalendars(supabase, venueId, month)
      .then((result) => {
        if (cancelled) return;
        setReserved(result.reserved);
        setBlocked(result.blocked);
        setAuspicious(result.auspicious);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [supabase, venueId, month]);

  const days = useMemo(() => {
    const [year, monthNo] = month.split("-").map(Number);
    const first = new Date(year, monthNo - 1, 1);
    const count = new Date(year, monthNo, 0).getDate();
    const offset = first.getDay();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: count }, (_, i) => i + 1),
    ];
  }, [month]);

  const shiftMonth = (delta: number) => {
    const [year, monthNo] = month.split("-").map(Number);
    const d = new Date(year, monthNo - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const [year, monthNo] = month.split("-").map(Number);
  const monthLabel = new Date(year, monthNo - 1, 1)
    .toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <section>
      <h2>MPR Event Calendars</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <label>Venue{" "}
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.venue_name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => shiftMonth(-1)}>Previous</button>
        <strong>{monthLabel}</strong>
        <button type="button" onClick={() => shiftMonth(1)}>Next</button>
        <input aria-label="Choose month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>🟢 Reserved</span><span>🔴 Blocked</span><span>🟡 Auspicious</span>
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading calendars…</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 16 }}>
        <MonthCalendar title="Reserved Calendar" color="#16834d" month={month} days={days} entries={reserved} auspicious={[]} />
        <MonthCalendar title="Blocked Calendar" color="#c24141" month={month} days={days} entries={blocked} auspicious={[]} />
        <MonthCalendar title="Auspicious Calendar" color="#b7791f" month={month} days={days} entries={[]} auspicious={auspicious} />
      </div>
    </section>
  );
}

function MonthCalendar({
  title, color, month, days, entries, auspicious,
}: {
  title: string;
  color: string;
  month: string;
  days: Array<number | null>;
  entries: CalendarEntry[];
  auspicious: AuspiciousDate[];
}) {
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [year, monthNo] = month.split("-").map(Number);

  const dayItems = (day: number) => {
    const dateKey = `${year}-${String(monthNo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const matchingEntries = entries.filter((e) => e.start_date <= dateKey && e.end_date >= dateKey);
    const matchingAuspicious = auspicious.filter((a) => a.date === dateKey);
    return (
      <div style={{ fontSize: 11, marginTop: 4 }}>
        {matchingEntries.map((e) => (
          <div key={e.id} title={e.event_name ?? e.block_reason_code ?? ""}>
            {e.booking_mode === "time_slot" ? `${e.start_time?.slice(0,5)}–${e.end_time?.slice(0,5)}` : "All day"}
          </div>
        ))}
        {matchingAuspicious.map((a) => <div key={a.id} title={a.title}>✦ {a.title}</div>)}
      </div>
    );
  };

  return (
    <article style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
      <h3 style={{ color, marginTop: 0 }}>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 3 }}>
        {weekday.map((d) => <div key={d} style={{ textAlign: "center", fontWeight: 700, fontSize: 12 }}>{d}</div>)}
        {days.map((day, i) => day === null
          ? <div key={`empty-${i}`} />
          : <div key={day} style={{ minHeight: 72, border: "1px solid #eee", borderRadius: 5, padding: 4, overflowWrap: "anywhere" }}>
              <strong>{day}</strong>
              {dayItems(day)}
            </div>
        )}
      </div>
    </article>
  );
}
