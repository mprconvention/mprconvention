export const bookingBehaviors: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  entry_statuses: { pending: "Pending", confirmed: "Confirmed", blocked: "Blocked" },
  booking_modes: { full_day: "Full day", time_slot: "Time slot (same day)" },
};
