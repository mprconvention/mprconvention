import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingTimeRange } from "../lib/bookingPicklists";
import { getActiveVenues, getAvailability } from "../lib/mprCalendars";

type Venues = Awaited<ReturnType<typeof getActiveVenues>>;
type Availability = Awaited<ReturnType<typeof getAvailability>>;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MprCalendars({ supabase }: { supabase: SupabaseClient }) {
  const [venues, setVenues] = useState<Venues>([]);
  const [venueId, setVenueId] = useState("");
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).format(new Date()));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    getActiveVenues(supabase).then(rows => {
      if (!current) return;
      setVenues(rows);
      setVenueId(rows[0]?.id ?? "");
    }).catch(e => {
      if (current) setError(e.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [supabase]);

  useEffect(() => {
    if (!venueId) return;
    let current = true;
    setAvailability(null);
    setError("");
    setLoading(true);
    async function load() {
      try {
        const data = await getAvailability(supabase, venueId, month);
        if (current) { setAvailability(data); setError(""); }
      } catch (e: any) {
        if (current) { setError(e.message); setAvailability(null); }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [supabase, venueId, month]);

  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const weekdayOffset = firstDay.getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  function shiftMonth(delta: number) {
    const date = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  return <section>
    <div className="availability-controls">
      <label>Venue <select value={venueId} onChange={e => setVenueId(e.target.value)}>
        {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.venue_name}</option>)}
      </select></label>
      <button className="outline-btn" type="button" onClick={() => shiftMonth(-1)}>Previous month</button>
      <input aria-label="Choose month" type="month" value={month}
        onChange={e => { if (/^[1-9]\d{3}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} />
      <button className="outline-btn" type="button" onClick={() => shiftMonth(1)}>Next month</button>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {loading && <p role="status">Loading availability…</p>}
    {!error && !loading && !venueId && <p>No active venues.</p>}
    {availability && <article className="availability-calendar" aria-label="Venue availability">
      <h2>{firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
      <div className="availability-grid">
        {weekdays.map(day => <strong key={day} className="availability-weekday">{day}</strong>)}
        {Array.from({ length: weekdayOffset }, (_, index) => <div key={`blank-${index}`} />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const occupied = availability.entries.filter(entry => entry.start_date <= date && entry.end_date >= date);
          const occasions = availability.auspicious.filter(entry => entry.date === date);
          return <div className="availability-day" key={date}>
            <strong>{day}</strong>
            {occupied.length === 0 && <span className="availability-free">Available</span>}
            {occupied.map(entry => (
              <div key={entry.id} className={`availability-slot ${entry.is_hold ? "hold" : entry.entry_type}`}>
                <b>{entry.is_hold ? "On hold" : entry.entry_type === "blocked" ? "Blocked" : "Reserved"}</b>
                <span>{entry.booking_mode === "time_slot" ? bookingTimeRange(entry.start_time, entry.end_time) : "All day"}</span>
              </div>
            ))}
            {occasions.map(entry => <div className="availability-occasion" key={entry.id}>{entry.title}</div>)}
          </div>;
        })}
      </div>
    </article>}
  </section>;
}
