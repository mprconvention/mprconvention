# MPR Vercel Frontend

A React + TypeScript + Vite frontend starter for the existing MPR Supabase project. It uses MPR-managed sessions through the deployed Supabase Edge Functions; it does not use Supabase Auth.

## Included frontend
- MPR username/email login.
- Session verification via `mpr-me`, logout, and forced password-change screen.
- Permission-filtered navigation.
- Live operational counts and permission-filtered quick links.
- Unified venue availability with reservations, blocks, holds and auspicious dates.
- Administrator user list/create/activate-deactivate screen.
- Administrator LOV configuration screen using existing `mpr-api` actions.
- Responsive desktop/mobile layout.

## Records and configurable picklists

Bookings, customers, venues and auspicious dates use permission-checked API actions. Record lists search the database in pages of 25, including historical bookings and inactive venues. Reports remains optional.

Record tables store created by, created date/time, modified by and modified date/time. Record screens display actor names and timestamps in India Standard Time (IST). Existing dates are preserved, and unknown historical actors appear as "Not recorded".

In **Configuration**, administrators can create picklists and add, rename, reorder or deactivate values. Forms use the configured labels and save stable codes. Configurable fields include entry status, booking mode, event type, booking source, block reason, customer category, venue type, auspicious category and region. When adding an entry status or booking mode, select the booking behavior that the new option should use. For example, Tentative can use Pending behavior. Saved bookings retain their selected value when an option is deactivated. Multiple days reserves each date in the selected range, including the end date. First half runs from midnight to noon and second half from noon to midnight in the venue time zone.

The Configuration table shows where each picklist is used. **Change history** is available to administrators and shows the previous and new values for tracked record fields.

To add a picklist field to another table, add a nullable text column in a migration, attach or extend a BEFORE INSERT OR UPDATE trigger using `public.mpr_validate_picklists('column_name','list_code')`, and use the shared `PicklistSelect` in the corresponding form. Add the field to that module's protected read and write actions. Keep the same list code across SQL and the form. Adding options to a connected field requires only Configuration access.

## Team booking workflow

Open **Bookings** to search or create an entry. Find an existing customer by name, or use **Create customer** if your role has customer creation access. The new customer is selected automatically. Users with customer view access can also search by mobile or email. The **Team** role uses explicit module grants. Assign **Calendar blocks** access separately for users who maintain venue blocks.

A pending reservation can hold a slot for 30 minutes, 1 hour, 4 hours or 24 hours. Once the hold expires, the slot is available again and the old entry remains searchable. Confirm a pending entry before it expires to reserve the slot without expiry. If another user updates or cancels an entry, refresh and reopen it before applying your changes again.

**Booking workflow** permissions enable optional inquiry, quote, deposit, reminder and instruction records. Open the booking workflow from a reservation to link records such as deposits and event-day instructions. Record deposits received through your existing payment process. Scheduled reminders appear in the workflow list with their due times.

## 1. Local setup
Install Node.js 20+ and npm. Extract this folder, open a terminal in this folder, then:

```bash
npm install
copy .env.example .env.local
```

Edit `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Use the Supabase publishable/anon key only. Never put the service-role key in any `VITE_` variable or frontend file.

Start locally:

```bash
npm run dev
```

Vite runs at `http://localhost:5173` by default. Your Supabase Edge Function secret `MPR_ALLOWED_ORIGIN` must match this origin exactly during local testing.

## 2. Reconcile existing databases

The migration files are ordered from the original Auth schema through the current MPR schema. Keep their version numbers intact. A new local database can replay the entire sequence. The existing hosted project may have migrations already applied through the SQL editor.

1. Run `supabase migration list --db-url "$SUPABASE_DB_URL"` against the intended project.
2. For any historical version missing from the ledger, compare the version's SQL against the deployed schema and audit how it was applied. Once verified, use `supabase migration repair VERSION --status applied --db-url "$SUPABASE_DB_URL"` for that version. If the schema differs, reconcile it on staging before making a production change.
3. Run `supabase db push --db-url "$SUPABASE_DB_URL" --dry-run`. The customer-category fix is `20261120000400`, the team booking migration is `20261120000500`, and the optional workflow migration is `20261120000600`. Verify the pending list against the target before releasing.

The workflow checks the migration ledger through `20261120000300` before a production push. The team booking migration backfills one allocation per active calendar entry and moves the overlap constraint to the allocation table. Allow time for that backfill and the table locks in the release window. Retain the existing module grants and review who needs separate venue block access.

## 3. Database-backed release checks

Node.js 22, the Supabase CLI and Docker or Podman are required for the local integration suite. Run these commands from a shell that supports Bash syntax:

```bash
supabase start
supabase functions serve
```

Run the following in a second terminal with the local stack running:

```bash
set -a
source <(supabase status -o env)
set +a
npm run test:staging
```

The GitHub **Supabase staging checks** job replays all migrations, verifies an upgrade over a populated database and runs the Edge Function suite against PostgreSQL. It covers overlapping saves, adjacent half-days, concurrent edits, role restrictions, customer-category persistence, expiry, pagination and account-update rollback.

## 4. Production release

Production deployment is a manual dispatch of **Team booking release** from `main`. The production job waits for the staging job in the same run. Vercel's Git auto-deployment for `main` is disabled in `vercel.json`. Configure the GitHub `production` environment and restrict deployment access there.

- Secrets required by the workflow are `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN`.
- Environment variables required by the workflow are `SUPABASE_PROJECT_REF`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and `VERCEL_CLI_VERSION`.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. Set `MPR_ALLOWED_ORIGIN` to the production frontend origin in Supabase.

The workflow builds the frontend, checks migration history, applies pending migrations, deploys Edge Functions, and publishes the frontend in that order. Refresh open booking tabs after rollout because saving and cancelling require the current booking revision.

Keep MPR session tokens, database URLs, and service-role credentials out of the browser and repository.
