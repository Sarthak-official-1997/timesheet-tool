# Deploying Field Planner (Vercel + PWA + push notifications)

## 1. Deploy to Vercel
From this folder (`Timesheet_tool/`):

```
npm i -g vercel   # once, if you don't have it
vercel             # first deploy, follow the prompts
vercel --prod      # promote to your production URL
```

Or connect this folder as a GitHub repo and import it in the Vercel dashboard —
either way works, since it's just static files + a couple of serverless
functions in `api/`.

## 2. Supabase (reuses your existing Cloud Sync project)
Open your Supabase project → SQL Editor → run `supabase-setup.sql` from this
folder once. It creates a locked-down `push_subscriptions` table (RLS on, no
policies — only your Vercel functions can touch it, via the service role key).

Grab two values from Supabase → Project Settings → API:
- Project URL → `SUPABASE_URL`
- `service_role` secret key (NOT the `anon` key) → `SUPABASE_SERVICE_KEY`

## 3. Environment variables
`.env.local` in this folder already has generated VAPID keys — copy all of
these into Vercel → Project → Settings → Environment Variables:

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (already generated)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (from step 2)
- `CRON_SECRET` — any random string you make up; Vercel automatically sends
  it as a Bearer token when the daily cron fires, so the notification
  endpoint can tell a real cron run from a random request to its URL.

Redeploy after adding env vars (`vercel --prod`) so the functions pick them up.

## 4. Using it
- Open the deployed URL on your phone → browser menu → **Add to Home
  Screen** (Android/Chrome) or **Share → Add to Home Screen** (iOS Safari).
  It now launches full-screen like an app.
- Tap **Cloud sync** first and set up your Supabase URL/anon key/sync code
  (same as before) — the notification job reads your data from there, so
  it has to be turned on for notifications to know anything about your
  calendar.
- Tap **🔔 Notifications** and allow the permission prompt. That's it — a
  daily check (20:30 IST, see `vercel.json`) will push:
  - a reminder if today isn't logged yet,
  - a countdown at 3 days / 1 day / day-of before your next tagged trip,
  - a heads-up if your in-office % is trending below 60% late in the month.

## Notes
- `lib/planner-logic.js` is a hand-kept mirror of the day-type/stats logic
  in `index.html`. If you change the default day type, holiday rules, or
  the office-% formula in the app, update both places.
- Notification timing/thresholds live at the top of
  `api/send-notifications.js` (`TRIP_COUNTDOWN_DAYS`,
  `LOW_OFFICE_PCT_FROM_DAY`, `LOW_OFFICE_PCT_TARGET`) if you want to tweak
  them later.
- Icons in `icons/` are flat placeholder PNGs (solid accent color) generated
  locally — swap them for a real logo whenever you like, same filenames.
