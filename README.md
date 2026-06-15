# Daily Intake

A single-user, AI-driven food and fitness tracker. Plain English in, structure out: you type what you ate or did, the AI resolves the macros / parses the workout, and you only ever see two numbers and two lists. Built as an installable PWA — no App Store needed.

Built from `fitness-app-spec.md`.

## Stack

- **Next.js (App Router)** on Vercel
- **Supabase** — email-OTP auth, Postgres, private photo storage
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — body analysis + macro targets (onboarding & weekly check-in)
- **Gemini 3.5 Flash** (`gemini-3.5-flash`, Google Search grounding) — food macro lookup + workout parsing + weekly insight
- **Gemini image model** (`gemini-3.1-flash-image`, "Nano Banana") — one-time illustrations & app icon
- **SheetJS** — client-side Excel export
- **PWA** — manifest + offline-shell service worker

All AI keys and the Supabase service-role key are used **server-side only** (`/api/*` route handlers). The browser never sees them.

## Setup

### 1. Install
```bash
npm install
```

### 2. Create a Supabase project
1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project** (free tier).
2. **Project Settings → API** — copy the Project URL, the `anon` key, and the `service_role` key.
3. Fill these into `.env` (placeholders already added):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
4. **Auth → Providers → Email**: enable Email, and make sure **"Email OTP"** is on (so a 6-digit code is sent, not a magic link).

> **Multi-user:** anyone can sign up with their email; each user's data is isolated by row-level security. First + last name are collected in onboarding and used to personalize the app (greetings, nudges, summary).

> **Email rate limit:** Supabase's built-in email sender is capped (~3-4/hour) on the free tier. For real multi-user traffic, add a custom SMTP provider under **Auth → Settings → SMTP** (e.g. Resend, SendGrid) to lift the cap.

### 3. Create the database
In the Supabase dashboard → **SQL Editor** → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates all tables, row-level security (each row locked to its owner), and the private `photos` storage bucket.

### 4. Run
```bash
npm run dev
```
Open http://localhost:3000, enter your allow-listed email, type the 6-digit code from your inbox, and complete onboarding.

## Deploy (Vercel)
1. Push to a Git repo, import into Vercel.
2. Add every variable from `.env` to **Vercel → Settings → Environment Variables**.
3. Deploy. In Supabase **Auth → URL Configuration**, add your Vercel URL to the redirect allow-list.

## Install on iPhone
Open the deployed URL in Safari → Share → **Add to Home Screen**. It opens full-screen and stays logged in until you sign out.

## Security notes
- ⚠️ The API keys originally committed to `.env` should be **rotated** before any public deploy — they were exposed during the build session.
- `.env` is gitignored. Never commit it.
- The allow-list (`ALLOWED_EMAIL`) means anyone with the link only ever sees the login screen.

## Build order map (from the spec)
| Phase | What | Where |
|---|---|---|
| 1 | PWA shell, OTP auth, two-tab layout | `app/login`, `middleware.ts`, `api/auth/*`, `manifest.json`, `sw.js` |
| 2 | Data spine, counters, date nav | `supabase/schema.sql`, `lib/db.ts`, `components/MainApp.tsx`, `TopCounter.tsx` |
| 3 | Food AI (Gemini grounded) | `api/food/parse`, `lib/ai/gemini.ts`, `components/AddSheet.tsx` |
| 4 | Onboarding + Claude body analysis | `app/onboarding`, `api/onboarding/analyze`, `lib/ai/anthropic.ts` |
| 5 | Exercise AI + 7-day insight | `api/exercise/*`, exercise list in `MainApp.tsx` |
| 6 | Streaks, day counter, nudges | `lib/streak.ts`, `lib/nudges.ts`, `components/Toast.tsx` |
| 7 | Check-in, settings, export | `api/checkin/*`, `app/settings`, `components/CheckIn.tsx`, `lib/export.ts` |
| 8 | Illustrations, icons, polish | `api/images/generate`, `public/icons/` |
```
