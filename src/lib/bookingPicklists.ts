const modeLabels = {
  full_day: "Full day",
  multiple_days: "Multiple days",
  time_slot: "Time slot (same day)",
  first_half: "First half",
  second_half: "Second half",
};

export type BookingSchedule = keyof typeof modeLabels;
export type BookingMode = "full_day" | "time_slot";

export const bookingBehaviors: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  entry_statuses: { pending: "Pending", confirmed: "Confirmed", blocked: "Blocked" },
  booking_modes: modeLabels,
};

export const halfDayTimes: Partial<Record<BookingSchedule, string>> = {
  first_half: "12:00 AM to noon",
  second_half: "Noon to midnight",
};

export function getBookingSchedule(behavior: string | undefined, fallback: string | undefined, mode: BookingMode): BookingSchedule {
  if (behavior && Object.hasOwn(modeLabels, behavior)) return behavior as BookingSchedule;
  if (fallback && Object.hasOwn(modeLabels, fallback)) return fallback as BookingSchedule;
  return mode;
}

export function bookingModeForSchedule(schedule: BookingSchedule): BookingMode {
  return schedule === "full_day" || schedule === "multiple_days" ? "full_day" : "time_slot";
}

export function bookingEndDate(schedule: BookingSchedule, startDate: string, endDate: string) {
  if (bookingModeForSchedule(schedule) === "time_slot" || !startDate) return startDate;
  if (endDate > startDate || schedule === "full_day" && endDate === startDate) return endDate;
  if (schedule === "full_day") return startDate;
  const nextDay = new Date(startDate + "T00:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString().split("T")[0];
}

export function bookingTimeRange(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) return "";
  const end = endTime.slice(0, 5);
  return startTime.slice(0, 5) + "–" + (end === "24:00" ? "midnight" : end);
}
