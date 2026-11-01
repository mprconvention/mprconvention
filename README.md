# MPR Vercel Frontend

A React + TypeScript + Vite frontend starter for the existing MPR Supabase project. It uses MPR-managed sessions through the deployed Supabase Edge Functions; it does not use Supabase Auth.

## Included frontend
- MPR username/email login.
- Session verification via `mpr-me`, logout, and forced password-change screen.
- Permission-filtered navigation.
- Dashboard shell and quick links.
- Three-calendar view (reserved, blocked, auspicious) using the existing `mpr-api` actions.
- Administrator user list/create/activate-deactivate screen.
- Administrator LOV configuration screen using existing `mpr-api` actions.
- Responsive desktop/mobile layout.

## Important implementation boundary
The currently deployed `mpr-api` from the upgrade package supports active venue lookup, three-calendar reads, LOV list/value reads, and LOV value create/update. The current frontend therefore marks Bookings, Customers, Venues management, Auspicious-date management, and Reports as awaiting their protected CRUD API endpoints. It does not fabricate records or pretend these pages are live. Those backend actions and corresponding forms must be implemented before operational use.

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

## 2. Existing Supabase project
Migration 006 has already been run by the project owner. **Do not run migration 006 again, and do not rerun migrations 001–005.** The `supabase/` folder is included so the backend source can be maintained/deployed alongside the frontend; the SQL migration is historical reference for this existing project.

The functions were previously deployed. The frontend uses:
- `mpr-login`
- `mpr-me`
- `mpr-logout`
- `mpr-change-password`
- `mpr-api`
- `admin-create-user`
- `admin-update-user`
- `admin-list-users`

One small safety fix was made to `admin-update-user`: when `permissions` is omitted, it now preserves existing permissions instead of deleting them. Redeploy this function from this package:

```bash
npx supabase functions deploy admin-update-user --no-verify-jwt
```

The frontend sends the MPR session token in the `Authorization: Bearer ...` header. The token is held in `sessionStorage` for the current browser tab session; this is a practical starter approach, not an HttpOnly-cookie design. Apply a strong Content Security Policy and complete security review before production.

## 3. Vercel deployment
1. Push this folder to a private GitHub repository.
2. In Vercel, choose **Add New → Project**, import that repository.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the same values as `.env.local`.
5. Deploy.
6. Copy the Vercel production domain and update Supabase Edge Function secret:

```bash
npx supabase secrets set MPR_ALLOWED_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app
```

For preview deployments, either use a stable preview domain or extend the Edge Function CORS implementation to an explicit allowlist. Do not use `*` with authenticated requests.

## 4. Build and test

```bash
npm run build
```

The dashboard/calendar/user/LOV views require the matching Edge Functions to be deployed and the logged-in account to have the corresponding permissions. Test with a non-production account first.

## Security reminder
A session token was pasted into a chat during troubleshooting. Treat it as compromised. Before using this frontend, revoke existing admin sessions in Supabase SQL Editor:

```sql
DELETE FROM public.mpr_sessions
WHERE user_id = '22333de2-80e2-4910-a798-d25e0eb87a1c';
```

Then sign in again. Never share session tokens, passwords, or the service-role key.
