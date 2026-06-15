# Personal Food and Fitness Tracker - Build Specification

> A single-user, minimalist, AI-driven nutrition and training tracker. Built for one person (the owner), accessed on iPhone via the browser as a home-screen web app. Not for the App Store or Play Store. This document is the full ideation spec, written to be handed to Claude (or any builder) to implement.

---

## 1. Vision and Principles

Most fitness apps fail by doing too much: cluttered dashboards, endless forms, food databases that never have the right item, rigid plans. This app does the opposite.

The core idea: you talk to it in plain English, the AI does the math, and you only ever see two numbers that matter and two lists that grow. Everything else is hidden until needed.

Guiding principles:

1. **One user, no accounts to manage.** Built for the owner only. Login exists only to protect the data and sync across devices.
2. **Plain English in, structure out.** You type "cashew 20 grams, oats 40 grams." The AI figures out the macros. You never search a database.
3. **Minimal surface.** White background, two main tabs, a goal counter at the top, a growing list below. Nothing else on screen by default.
4. **No nagging targets on exercise.** Food has hard daily macro goals. Exercise has no targets, only a frequency you set and gentle observations the AI makes after it has watched a full week.
5. **Earned suggestions.** The app does not give advice on day one. It watches for 7 days, then suggests. This avoids generic advice and grounds everything in your actual equipment, volume, and intake.
6. **Delight without clutter.** A clean palette, a few AI-generated illustrations, light animation, and a streak system that nudges you to keep going.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) | First-class on Vercel, supports server routes to hide API keys, easy PWA setup |
| Hosting | Vercel (Hobby / free tier) | Free, instant deploys, custom subdomain to link from your homepage |
| Auth | Supabase Auth (email OTP) | Free, email one-time-code login, session persists until sign-out |
| Database | Supabase Postgres | Free 500MB, same project as auth |
| File storage | Supabase Storage | Free 1GB, holds progress and food photos |
| Body analysis AI | Claude Sonnet 4.6 (Anthropic API) | Strong vision reasoning for body-fat estimate and macro setup |
| Food / exercise AI | Gemini 3.5 Flash (Google AI API) | Fast, cheap, native Google Search grounding for accurate macro lookup |
| Budget AI option | Gemini 3.1 Flash-Lite | Even cheaper for high-volume food logging if cost matters |
| Image generation | Gemini "Nano Banana" image model | Generates the onboarding and streak illustrations |
| Excel export | SheetJS (xlsx) | Client-side export of food and exercise logs |
| Charts (optional) | Recharts | Simple weight and macro trend lines |

### Notes on models (verify strings at build time, this space moves fast)
- Food and exercise parsing: `gemini-3.5-flash` is the current GA flash model and supports Google Search grounding, which is what powers the "look up the real macros" step. Use `gemini-3.1-flash-lite` if you want to cut cost.
- Body analysis: Claude Sonnet 4.6, model string `claude-sonnet-4-6`.
- Image generation: the "Nano Banana" line is current. The older `*-image-preview` model strings are being retired, so pull the current GA Nano Banana model string from Google AI docs when you build.

### Critical security rule
All AI calls (Anthropic and Gemini) and the Supabase service-role key go through **Next.js server route handlers only**. Never expose API keys in client code. The browser calls your own `/api/*` routes, those routes call the AI providers. This is non-negotiable since the app is publicly linkable.

---

## 3. Why a PWA, not a native app

You want it on your iPhone 16 without the App Store. Build it as a Progressive Web App:

- Add a `manifest.json` with `display: standalone`, app name, theme color, and icons.
- On iPhone, open the Vercel URL in Safari (Chrome on iOS uses Safari's engine for PWA installs), tap Share, then "Add to Home Screen."
- It then opens full-screen with no browser chrome, behaves like a native app, and keeps you logged in.
- Add a service worker for basic offline shell caching so the app opens instantly even on a weak signal. Data still needs network for AI calls.

You can link the Vercel URL from your homepage as planned, but anyone with the link only sees the login screen, and only your email can get an OTP.

---

## 4. Design System

Minimal does not mean plain. The rule: white canvas, one confident accent, generous spacing, large tap targets, and small moments of motion.

### Color palette (track colors, calm and modern)
- **Canvas:** pure white `#FFFFFF` and a near-white surface `#FAFAF8`
- **Ink (text):** `#1A1A1A` primary, `#6B7280` secondary
- **Accent (primary action, progress fill):** a deep matcha green `#2F7A4D`, healthy and not aggressive
- **Macro accents (for the rings):**
  - Protein: `#2F7A4D` (green)
  - Carbs: `#E0A458` (warm amber)
  - Fat: `#7C6AE0` (soft violet)
  - Calories: `#1A1A1A` (ink ring, the master ring)
- **Success / streak:** `#F2B705` (gold)
- **Rest day:** `#9CA3AF` (muted grey)

Keep it to this set. Color is information here (each macro has a fixed hue), so do not introduce random colors elsewhere.

### Typography
- One typeface, two weights. Use **Inter** or **Geist**. Big numbers for counters (the macros are the hero), regular weight for body, medium for labels.
- Numbers should feel like a dashboard: large, tabular figures so they do not jump as they change.

### Motion
- Counters animate (count up/down) when a meal is logged, never instant snap.
- Progress rings fill with a short ease.
- Streak nudges slide in from the top, auto-dismiss.
- Keep all animation under 400ms. Subtle, not bouncy.

### AI-generated art (the delight layer)
Use the Gemini image model to generate a small, consistent set of illustrations once, store them in Supabase Storage, and reuse them. Do not generate on every load (cost and latency).

Generate:
- An onboarding hero illustration (clean, flat, single-accent, e.g. a minimalist figure mid-lift).
- A small set of streak milestone badges (day 7, 14, 30, 60, 100) in a consistent flat style.
- A "rest day" calm illustration.
- An empty-state illustration for when no meals are logged yet.

Prompt them in one consistent style: "flat minimalist vector illustration, white background, single matcha-green accent, soft, calm, no text." Save and reuse.

---

## 5. Authentication Flow

1. User opens the app. If no valid session, show the **Login screen**: white, centered, one input for email, one button "Send code."
2. Supabase sends a 6-digit OTP to the email.
3. User enters the code. On success, Supabase creates a session.
4. Session persists until the user explicitly taps **Sign out** in Settings. No auto-expiry that kicks you out daily.
5. Since this is single-user, you can optionally hardcode an allow-list: only the owner's email can request a code. Everyone else who finds the link gets "This app is private."

Implementation: Supabase `signInWithOtp({ email })` then `verifyOtp`. Store nothing sensitive client-side beyond the Supabase session token it manages for you.

---

## 6. First-Time Onboarding (the setup conversation)

This runs once, the first time the user logs in. It feels like a short, friendly AI conversation, not a form wall. Keep it to a handful of questions, one screen at a time, with a progress dots indicator.

### What to collect (basic, not exhaustive)
1. **Name** (optional, for nudges and warmth).
2. **Age.**
3. **Height** (cm or ft/in toggle).
4. **Current weight** (kg or lb toggle).
5. **Sex / build** (needed for macro math: male / female / prefer not to say, with a sensible default).
6. **Build / heritage context** (light touch): a single optional field like "anything about your build worth knowing" with examples ("South Indian frame, ectomorph, broad shoulders"). This nudges the AI's body-type read, it is not a rigid metric.
7. **Photos for body analysis:** prompt to upload a front photo (and optionally a side photo). Make this clearly optional and clearly private (stored in your own Supabase, only you see it). Used to estimate body fat visually.
8. **Goal** (single choice, no number targets): Body recomposition / Lean bulk / Cut / Maintain / "Just want a great body, you decide." Let one of these be selected, plus an optional one-line free text ("want visible abs but keep strength").

Do not ask for a target weight, target date, or activity multipliers explicitly. Infer activity as moderate by default and let the 7-day check-in correct it.

### Body analysis call (Claude Sonnet 4.6)
Send the photo(s) plus age, height, weight, sex/build, heritage note, and goal. Ask Claude to return:
- An **estimated body-fat range** (a range, not a false-precision single number) with a one-line confidence caveat.
- A short **body-type read** (e.g. "lean with low upper-body mass, classic recomp candidate").
- **Daily macro targets**: calories, protein (g), carbs (g), fat (g), tuned to the goal.

Guardrails to bake into the prompt: never recommend an aggressive deficit, keep protein in a sane range (around 1.6 to 2.2 g per kg bodyweight), never suggest calories below a safe floor, and frame the body-fat number as an estimate, not a medical reading.

### Output of onboarding
Save the returned macro targets as the user's **active goal**. Show a clean summary screen:

> "Here is your daily target. Protein 165g. Calories 2,450. Carbs 240g. Fat 70g. Tap to start logging."

From now on, every time the app opens, this target is the top of the food screen.

---

## 7. Data Model (Postgres / Supabase)

```
users (managed by Supabase Auth)
  id, email

profiles
  user_id (fk)
  name
  age
  height_cm
  sex
  build_note
  unit_pref (metric / imperial)
  created_at

goals                      -- versioned, never overwrite, so old data stays valid
  id
  user_id
  effective_from (date)
  calories
  protein_g
  carbs_g
  fat_g
  goal_type (recomp / bulk / cut / maintain)
  source (onboarding / 7day_checkin / manual_settings)
  body_fat_estimate
  notes
  is_active (bool)

weigh_ins
  id, user_id, date, weight_kg, photo_url (nullable), note

food_logs
  id
  user_id
  date
  meal_label (breakfast / lunch / snack / dinner / free text)
  raw_input (the English the user typed)
  photo_url (nullable)
  calories, protein_g, carbs_g, fat_g     -- AI-resolved totals for this entry
  items_json    -- per-item breakdown from the AI
  created_at

exercise_logs
  id
  user_id
  date
  type (strength / cardio / other)
  raw_input
  parsed_json   -- exercises, sets, reps, weight, volume OR cardio type/duration/distance
  est_calories (nullable)
  created_at

exercise_config
  user_id
  weekly_target_sessions (int)
  split_pattern (e.g. "PPL,rest" or "PP,rest,PP,rest")  -- freeform but structured
  cardio_target_per_week (nullable)

streaks
  user_id
  current_streak
  longest_streak
  last_log_date
  total_days_logged
```

Key design rule: **goals are versioned.** When the user changes age/weight in Settings and taps Refresh, or when the 7-day check-in updates targets, you write a new `goals` row and flip `is_active`. Old `food_logs` keep referencing whatever goal was active on their date. This is how "old data stays as usual" works.

---

## 8. Main App Layout

After onboarding, the app is one screen with two tabs and a persistent top counter.

```
+------------------------------------------+
|  Day 14   *streak flame*   [settings]    |   <- streak + day counter, top bar
+------------------------------------------+
|        CALORIES   1,240 / 2,450          |   <- master counter, animated
|     P 92/165   C 130/240   F 38/70       |   <- macro rings / mini counters
+------------------------------------------+
|   [ FOOD ]            [ EXERCISE ]       |   <- two tabs
+------------------------------------------+
|                                          |
|   ...tab content (log list)...           |
|                                          |
+------------------------------------------+
|                [  +  Add  ]              |   <- single add button, opens input
+------------------------------------------+
```

The top counter always reflects the active tab's relevant data. On the Food tab it shows macros consumed vs goal. On the Exercise tab it shows sessions done this week vs your configured target.

---

## 9. Food Tab

### Adding a meal
1. Tap **+ Add**. A clean sheet slides up with one big text field and an optional camera/photo button.
2. User types natural English: `cashew 20g, oats 40g, milk 200ml, 2 eggs`. Optionally attaches a photo (or just a photo with no text).
3. User taps **Analyze**.
4. The text (and photo) go to a server route, which calls **Gemini 3.5 Flash with Google Search grounding**.
5. Gemini returns structured JSON: each item with resolved grams, calories, protein, carbs, fat, plus totals, plus any suggested adjustment (e.g. "milk assumed full-fat, tap to switch to skim").
6. Show a **confirmation card**: the per-item breakdown, the totals, and an "any adjustments?" line. User can tweak a gram value inline if they disagree.
7. User taps **OK**. The entry saves to `food_logs`, and the top counters animate: the consumed numbers go up, the remaining numbers go down.

### The list
Below the counter, a reverse-chronological list of today's entries: meal label, the foods, the calorie/macro totals, optional thumbnail. Tap an entry to edit or delete (which re-adjusts the counters).

### Date navigation
A simple left/right date stepper or a small calendar to view past days. Past days show that day's totals against that day's active goal.

### Gemini food prompt (server route)
System instruction shape:
> You are a nutrition resolver. Given a user's plain-English food log and optional photo, identify each food and quantity, use search grounding to get accurate macros, and return strict JSON only. If a quantity is ambiguous, make the most reasonable assumption and note it. Never invent foods not implied by the input.

Response schema (return JSON only, no prose):
```json
{
  "items": [
    {"name": "cashews", "grams": 20, "calories": 117, "protein_g": 3.9, "carbs_g": 6.6, "fat_g": 9.4, "assumption": null}
  ],
  "totals": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
  "notes": ["milk assumed full-fat"]
}
```

---

## 10. Exercise Tab

This tab is intentionally looser. No hard targets, just logging, a frequency you set, and earned observations.

### Configuration (set once, editable in Settings)
- **Weekly sessions target** (e.g. 5).
- **Split pattern**, freeform but guided: PPL rest (push, pull, legs, rest repeating), PP rest, Upper/Lower, Bro split, or your own. This is only used for the nudge ("today is a Pull day based on your pattern") and never enforced.
- **Optional cardio target** (e.g. 2 cardio sessions/week).

### Logging a session
1. Tap **+ Add** on the Exercise tab.
2. Type plain English:
   - Strength: `3 sets bench press 60kg x 8, 3 sets incline db 22kg x 10`
   - Cardio: `ran 5k in 28 minutes` or `30 min zone 2 cycling`
   - Or just: `rest day`
3. Server route calls Gemini to parse into structure: per exercise the sets, reps, weight, and computed volume (sets x reps x weight); for cardio the type, duration, distance, and an estimated calorie burn.
4. Save to `exercise_logs`. The top counter (sessions this week vs target) updates. Rest days are logged too, so the pattern stays honest.

### The "i" insight button (after 7 days only)
Do not show suggestions before 7 days of data exist. Once there are 7+ days of logs, an **i** button appears on the Exercise tab. Tapping it sends the week's parsed logs to Gemini, which returns observations grounded in what you actually did:
- Volume trends per muscle group.
- Imbalances (e.g. "lots of push volume, light on pulling").
- A gentle progression nudge (e.g. "bench has stalled at 60kg for 3 sessions, consider a small jump or an extra set").
- Suggestions framed against your visible equipment and exercises only, never generic.

These are suggestions, shown on demand. Never a target, never a red "you failed" state.

### Exercise list and history
Reverse-chronological log per day, grouped by week. Rest days shown in muted grey. Cardio entries shown with a distinct icon.

---

## 11. Gamification and Nudges

The goal is momentum, not pressure.

- **Day counter**: "Day 14" in the top bar, counting days since day one.
- **Streak**: consecutive days with any log (food or exercise). A flame icon, gold when active. Logging a rest day still counts as engagement.
- **Milestone badges**: AI-generated illustrations unlock at day 7, 14, 30, 60, 100. A small celebration animation when hit.
- **Nudges** (gentle, top-slide toasts, dismissible):
  - Morning: "Day 15. Yesterday you hit 162g protein, just shy of 165. Today's a fresh start."
  - Food: if no food logged by evening, "Haven't logged today's food yet."
  - Exercise: based on your weekly target and split, "3 of 5 sessions this week. Today looks like a Legs day."
  - Streak risk: "Your 13-day streak is alive, log anything to keep it going."
- Keep nudges to at most one or two a day. Over-nudging kills the calm feel.

Implement nudges client-side based on local state plus a daily check, or via a lightweight scheduled function. Do not spam.

---

## 12. The 7-Day Check-In (recalibration)

Seven days after day one (and recurring weekly thereafter), trigger a check-in flow:

1. A gentle prompt: "It's been a week. Quick check-in?"
2. Ask for **current weight** and optionally **a new photo or two**.
3. Send to Claude Sonnet 4.6: the new weight, new photos, the trend (weight change over the week), average daily intake vs the target, and the goal type.
4. Claude returns: an updated body-fat read, an assessment of whether the plan is working (gaining/losing at a healthy rate for the goal), and **proposed adjusted macros** if needed.
5. **Critically, do not auto-apply.** Show the user a clear comparison:

> "Your current target: 2,450 cal, 165g protein. Suggested new target: 2,550 cal, 170g protein, because your weight held steady and your goal is a lean bulk. Keep current plan or switch to the new one?"

6. If the user accepts, write a new active `goals` row. If they decline, keep the current goal. Either way, old logs stay tied to their original goals.

This is the only place the macro target changes automatically-ish, and even here the user has the final say.

---

## 13. Settings

A simple list screen. Editable any time:

- Name, age, height, current weight, sex/build note.
- Unit preferences (metric/imperial toggles).
- Goal type.
- Exercise config (weekly sessions, split pattern, cardio target).
- **Refresh goals** button: recomputes the active macro target from current profile values (calls the body-analysis logic again, optionally without new photos). On confirm, writes a new active `goals` row. The UI updates to the new numbers. All old data stays exactly as logged.
- Manage photos (view/delete stored progress photos).
- Export data (see below).
- Sign out (ends the session, the only thing that logs you out).
- Privacy note: "All data and photos live in your private database. Nothing is shared."

The refresh behavior is the key requirement: change inputs, tap refresh, new goal takes effect going forward, history is untouched.

---

## 14. Excel Export

Both tabs export to `.xlsx` using SheetJS, client-side, no server needed.

- **Food export**: one row per food entry with date, meal, raw input, calories, protein, carbs, fat, plus a daily totals summary sheet and a "vs goal" column.
- **Exercise export**: one row per session with date, type, raw input, parsed exercises/sets/reps/weight/volume, cardio details, estimated calories.
- Optionally a third sheet: weigh-ins and goal history over time.
- A single "Export everything" button produces one workbook with multiple sheets.

File name like `fitness-export-YYYY-MM-DD.xlsx`. On iPhone, the download opens the share sheet so you can save to Files or send it anywhere.

---

## 15. AI Call Summary (which model does what)

| Trigger | Model | Input | Output |
|---|---|---|---|
| Onboarding body analysis | Claude Sonnet 4.6 | photos, age, height, weight, sex/build, goal | body-fat range, body-type read, daily macros |
| Log a meal | Gemini 3.5 Flash (grounded) | English text + optional photo | per-item macros, totals, adjustments (JSON) |
| Log a workout | Gemini 3.5 Flash | English text | structured sets/reps/weight/volume or cardio (JSON) |
| Weekly exercise insight ("i") | Gemini 3.5 Flash | the week's parsed logs | observations and a progression nudge |
| 7-day check-in | Claude Sonnet 4.6 | new weight, photos, trend, avg intake | updated body-fat, assessment, proposed new macros |
| Illustrations (one-time) | Gemini Nano Banana | style prompt | onboarding/streak/empty-state art |

All calls server-side. Cache the illustrations. Consider caching common food lookups to cut Gemini cost over time.

---

## 16. Suggested Build Order (phases)

**Phase 1, the skeleton.** Next.js + Vercel deploy, Supabase project, email OTP login, PWA manifest, the two-tab empty shell with the top counter. Get it installable on the iPhone home screen first.

**Phase 2, the data spine.** Profiles, goals, food_logs, exercise_logs tables. Manual entry (type macros by hand) so the loop works before AI is wired. Counters animate, list grows, date navigation works.

**Phase 3, food AI.** Wire Gemini grounded parsing for the food tab. Confirmation card, inline edits, photo upload to Supabase Storage.

**Phase 4, onboarding + body analysis.** Claude Sonnet flow, photo upload, macro goal generation, the summary screen, versioned goals.

**Phase 5, exercise AI.** Workout parsing, split config, the 7-day-gated "i" insights button.

**Phase 6, gamification.** Streaks, day counter, milestone badges, nudges.

**Phase 7, recalibration + settings + export.** The 7-day check-in flow, full settings with refresh, Excel export.

**Phase 8, polish.** AI illustrations, animations, empty states, the calm details.

Ship Phase 1 and 2 fast so you have something real on your phone, then layer intelligence on top.

---

## 17. Open Decisions (worth settling before build)

1. **Photo retention:** keep all progress photos, or only the latest plus check-in milestones? Storage is 1GB free, so plenty, but decide the UX.
2. **Offline logging:** do you want to log food with no signal and sync later (harder), or require network for the AI step (simpler)? Recommend simple first.
3. **Cost ceiling:** Gemini Flash is cheap, but set a rough monthly cap and consider caching repeated foods. Claude Sonnet is used rarely (onboarding + weekly) so cost is low.
4. **Single confirm vs auto-save on food:** the spec uses a confirm card. If that feels slow daily, consider a "trust mode" that auto-saves and lets you correct after.
5. **Supabase pause:** free projects pause after 7 days idle. Daily use avoids it, but if you ever travel, a tiny scheduled ping keeps it warm.
6. **Body-fat framing:** always present as an estimate range with a caveat. It is a motivation and trend tool, not a clinical measurement.

---

## 18. One-paragraph brief for the builder

Build a single-user PWA on Next.js, deployed to Vercel, with Supabase for email-OTP auth, Postgres, and photo storage. The app has a white, minimal two-tab interface (Food, Exercise) with an animated macro counter pinned to the top. New users complete a short AI onboarding: a few basic questions plus optional shirtless photos, sent to Claude Sonnet 4.6, which returns an estimated body-fat range and daily macro targets saved as a versioned goal. Daily, the user logs food and workouts in plain English (with optional photos); a server route sends this to Gemini 3.5 Flash with Google Search grounding, which returns structured macros (food) or parsed sets and volume (exercise), and the top counters update. Exercise has no hard targets, only a user-set weekly frequency and split, plus an on-demand AI insight button that unlocks after 7 days of data. A weekly check-in re-reads weight and photos via Claude and proposes adjusted macros that the user can accept or decline, never auto-applied, with all historical logs preserved against their original goals. Gamification adds a day counter, streaks, milestone badges, and gentle nudges. Settings let the user edit profile values and tap Refresh to recompute the goal going forward without altering history. Both food and exercise logs export to Excel via SheetJS. All AI keys stay server-side. The visual style is white canvas, matcha-green accent, fixed per-macro colors, large dashboard numbers, subtle motion, and a small set of one-time AI-generated illustrations for delight.
