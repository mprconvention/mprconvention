# MPR backend work remaining

The supplied `mpr-api` is currently a starter endpoint. Before the portal can manage live business records, add server-side, permission-checked actions for:

- Venues: list/create/update/deactivate and venue settings.
- Bookings: search/list/create/update/cancel; validate venue, date/time, full-day/time-slot overlaps, customer and status.
- Calendar blocks: list/create/update/remove; overlap checks and actor IDs.
- Customers: search/list/create/update/archive; validate contact details and avoid duplicates.
- Auspicious dates: list/create/update/deactivate; manager/admin permissions.
- Reports: aggregate booking and revenue/operations data based on explicit business definitions.
- Audit: update audit trigger/context so custom MPR actor IDs are recorded (the legacy trigger used `auth.uid()`, which is null with custom auth).

Do not expose service-role credentials to the browser. Validate every action and permission inside Edge Functions. Add rate limiting/login lockout, session rotation, password reset, CSRF/XSS protections and a production security review before go-live.
