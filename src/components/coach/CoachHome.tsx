"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/Toast";
import { LoadingJoke } from "@/components/LoadingJoke";
import { ModeSwitch } from "@/components/ModeSwitch";
import { Icon } from "@/components/Icon";
import { PlanHeader } from "./PlanHeader";
import { MealDay } from "./MealDay";
import { WorkoutDay } from "./WorkoutDay";
import { fetchActivePlan, fetchPlanDays, setPlanStatus, deletePlan, fetchStreak, updatePlanMeta } from "@/lib/db";
import { todayIndex, isPlanOver, completedCount } from "@/lib/planProgress";
import { setMode, coachUnlocked, unlockProgress, UNLOCK_DAYS } from "@/lib/mode";
import { useLiquidGlass } from "@/lib/liquidGlass";
import { todayStr, prettyDate } from "@/lib/date";
import type { AiPlan, AiPlanDay, PlanKind, PlanFeedback } from "@/lib/types";

// The AI Coach: the app's second personality. Earned after a 7-day logging
// streak, entered through the mode switch, themed violet, and built around
// 30-day meal/training plans generated from the user's own last 30 days.
// All logging lands in the same tables as manual mode — data is one.

export function CoachHome({ onSwitchMode }: { onSwitchMode?: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<PlanKind>("meal");
  const [access, setAccess] = useState<"checking" | "locked" | "open">("checking");
  const [unlockDays, setUnlockDays] = useState(0);
  const topbarRef = useRef<HTMLDivElement>(null);
  useLiquidGlass(topbarRef, { scale: -60, blur: 4, fallbackBlur: 14 });

  // The whole page wears the AI theme while the Coach is mounted.
  useEffect(() => {
    document.documentElement.dataset.mode = "ai";
    return () => {
      delete document.documentElement.dataset.mode;
    };
  }, []);

  // Direct /coach visits still respect the 7-day unlock.
  useEffect(() => {
    fetchStreak()
      .then((s) => {
        setUnlockDays(unlockProgress(s));
        setAccess(coachUnlocked(s) ? "open" : "locked");
      })
      .catch(() => setAccess("locked"));
  }, []);

  function switchToManual() {
    if (onSwitchMode) onSwitchMode();
    else {
      setMode("manual");
      router.push("/");
    }
  }
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [days, setDays] = useState<AiPlanDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null); // progress label while the AI works
  const [sel, setSel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchActivePlan(kind);
      setPlan(p);
      if (p) {
        const d = await fetchPlanDays(p.id);
        setDays(d);
        setSel(todayIndex(d));
      } else {
        setDays([]);
      }
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  // Pre-generation questions: cheat meals for the week (meal plans) and rest
  // days (training plans). Sent with the request and remembered on the plan.
  const [cheatMeals, setCheatMeals] = useState(1);
  const [restDays, setRestDays] = useState(2);

  async function generate() {
    setGenerating(
      kind === "meal" ? "Reading your month of meals, planning your week…" : "Studying your lifts, planning your week…"
    );
    try {
      const res = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          prefs: kind === "meal" ? { cheat_meals: cheatMeals } : { rest_days: restDays },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Could not generate the plan.");
      await load();
      setToast(kind === "meal" ? "Your week of meals is ready 🍛" : "Your training week is ready 💪");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  // Re-plans the remaining days around what actually happened (missed days,
  // unexpected rests). Past days are never touched.
  async function adjust() {
    if (!plan) return;
    setGenerating("Reshuffling your remaining days…");
    try {
      const res = await fetch("/api/plan/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Could not adjust the plan.");
      await load();
      setToast("Week adjusted around how it's actually going ⤺");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  // End-of-week feedback: saved onto the finished plan, read by the next
  // generation so week two actually responds to week one.
  async function submitFeedback(fb: PlanFeedback) {
    if (!plan) return;
    await updatePlanMeta(plan.id, { ...(plan.meta ?? {}), feedback: fb });
    await setPlanStatus(plan.id, "completed");
    await load();
    setToast("Noted — your next week will be tuned to that 🎯");
  }

  async function stop() {
    if (!plan || !confirm("Stop this plan? Your completed days stay saved.")) return;
    await setPlanStatus(plan.id, "stopped");
    await load();
  }

  async function remove() {
    if (!plan || !confirm("Delete this plan and all its days? This cannot be undone.")) return;
    await deletePlan(plan.id);
    await load();
  }

  const day = days[sel] ?? null;
  const today = todayStr();

  if (access !== "open") {
    return (
      <div className="app-shell">
        <div className="topbar">
          <span className="daycount">AI Coach ✨</span>
        </div>
        <div className="coach-hero">
          {access === "checking" ? (
            <span className="spinner" style={{ borderTopColor: "var(--accent)" }} />
          ) : (
            <>
              <div className="coach-hero-icon">🔒</div>
              <h2>The Coach is earned</h2>
              <p className="muted">
                Log for {UNLOCK_DAYS} days in a row and the AI Coach unlocks — it needs to watch how you
                actually eat and train before it starts planning for you.
              </p>
              <div className="unlock-dots" aria-label={`${unlockDays} of ${UNLOCK_DAYS} days`}>
                {Array.from({ length: UNLOCK_DAYS }, (_, i) => (
                  <span key={i} className={`unlock-dot ${i < unlockDays ? "on" : ""}`}>
                    {i < unlockDays ? "✓" : i + 1}
                  </span>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{unlockDays} of {UNLOCK_DAYS} days — keep going 🔥</p>
              <button className="btn btn-primary" onClick={switchToManual}>Back to tracking</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="topbar glass topbar-sticky" ref={topbarRef}>
        <span className="daycount">AI Coach ✨</span>
        <ModeSwitch mode="ai" onSwitch={switchToManual} />
        <button className="icon-btn" aria-label="Analytics" title="Analytics" onClick={() => router.push("/analytics")}>
          <Icon name="stats-chart-outline" />
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={() => router.push("/settings")}>
          <Icon name="settings-outline" />
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 4 }}>
        <button className={`tab ${kind === "meal" ? "active" : ""}`} onClick={() => setKind("meal")}>
          🍛 Meals
        </button>
        <button className={`tab ${kind === "workout" ? "active" : ""}`} onClick={() => setKind("workout")}>
          🏋️ Training
        </button>
      </div>

      <div className="content coach-body">
        {generating ? (
          <LoadingJoke label={generating} />
        ) : loading ? (
          <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
        ) : !plan ? (
          <div className="coach-hero">
            <div className="coach-hero-icon">{kind === "meal" ? "🍛" : "📈"}</div>
            <h2>{kind === "meal" ? "A week of meals, made for you" : "A week of training, built on your lifts"}</h2>
            <p className="muted">
              {kind === "meal"
                ? "The coach reads your last 30 days of logged meals — your staples, your cuisine, your rhythm — and plans the next 7 to hit your goal. Real dishes with photos, portions, macros, and recipes."
                : "The coach studies your last 30 days of workouts and plans the next 7 with progressive overload — small, earned jumps in weight and reps. Every exercise comes with its animation."}
            </p>

            {kind === "meal" ? (
              <div className="setup-q">
                <span className="setup-q-label">Cheat meals this week?</span>
                <div className="pill-group" style={{ justifyContent: "center" }}>
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} className={`pill ${cheatMeals === n ? "on" : ""}`} onClick={() => setCheatMeals(n)}>
                      {n === 0 ? "None" : `${n} 🎉`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="setup-q">
                <span className="setup-q-label">Rest days this week?</span>
                <div className="pill-group" style={{ justifyContent: "center" }}>
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} className={`pill ${restDays === n ? "on" : ""}`} onClick={() => setRestDays(n)}>
                      {n} 😌
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="muted" style={{ fontSize: 13 }}>
              A fresh week every 7 days, tuned by your feedback. Stop or delete it anytime.
            </p>
            <button className="btn btn-primary" onClick={generate}>
              ✨ Plan my week
            </button>
          </div>
        ) : (
          <>
            <PlanHeader plan={plan} days={days} onStop={stop} onDelete={remove} onRegenerate={generate} onAdjust={adjust} />

            {isPlanOver(plan) && !plan.meta?.feedback && (
              <FeedbackCard kind={kind} completed={completedCount(days)} total={days.length} onSubmit={submitFeedback} />
            )}

            {plan.context_summary && (
              <div className="plan-context">
                <button className="ex-howto-toggle" onClick={() => setShowContext((v) => !v)}>
                  What the coach understood {showContext ? "▴" : "▾"}
                </button>
                {showContext && <p className="plan-context-text">{plan.context_summary}</p>}
              </div>
            )}

            <div className="day-strip">
              {days.map((d, i) => (
                <button
                  key={d.id}
                  className={`day-chip ${i === sel ? "sel" : ""} ${d.completed ? "done" : ""} ${d.date === today ? "today" : ""} ${d.date > today ? "future" : ""}`}
                  onClick={() => setSel(i)}
                >
                  <span className="day-chip-n">{d.day_index}</span>
                  {d.completed ? "✓" : d.date === today ? "•" : ""}
                </button>
              ))}
            </div>

            {day && !isPlanOver(plan) && (
              <>
                <div className="day-title">
                  <span>Day {day.day_index} · {prettyDate(day.date)}</span>
                  {day.date > today && <span className="day-locked">🔒 unlocks {prettyDate(day.date)}</span>}
                </div>
                {kind === "meal" ? (
                  <MealDay
                    key={day.id}
                    day={day}
                    locked={day.date > today}
                    onUpdated={(nd) => setDays((ds) => ds.map((x) => (x.id === nd.id ? nd : x)))}
                    onToast={setToast}
                  />
                ) : (
                  <WorkoutDay
                    key={day.id}
                    day={day}
                    locked={day.date > today}
                    onUpdated={(nd) => setDays((ds) => ds.map((x) => (x.id === nd.id ? nd : x)))}
                    onToast={setToast}
                    onReplan={adjust}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// End-of-week check-in. The answers are stored on the finished plan and fed
// into the next week's generation, so the plan actually listens.
function FeedbackCard({
  kind,
  completed,
  total,
  onSubmit,
}: {
  kind: PlanKind;
  completed: number;
  total: number;
  onSubmit: (fb: PlanFeedback) => void;
}) {
  const [liked, setLiked] = useState<boolean | null>(null);
  const [tune, setTune] = useState<"less" | "same" | "more">("same");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const tuneLabels: Record<"less" | "same" | "more", string> =
    kind === "workout"
      ? { less: "Easier", same: "Same", more: "More intensity" }
      : { less: "Lighter meals", same: "Same", more: "More food" };

  async function save() {
    setBusy(true);
    const fb: PlanFeedback = { liked: liked ?? undefined, note: note.trim() || undefined };
    if (kind === "workout") fb.intensity = tune;
    else fb.food = tune === "less" ? "lighter" : tune;
    await onSubmit(fb);
  }

  return (
    <div className="card feedback-card" style={{ animation: "none" }}>
      <div className="meal">Week done — {completed}/{total} days {completed === total ? "🏆" : "🎉"}</div>
      <p className="sub" style={{ marginBottom: 10 }}>Tell the coach how it went; next week adapts to this.</p>

      <span className="setup-q-label">Did you like this week?</span>
      <div className="pill-group" style={{ marginBottom: 10 }}>
        <button className={`pill ${liked === true ? "on" : ""}`} onClick={() => setLiked(true)}>👍 Loved it</button>
        <button className={`pill ${liked === false ? "on" : ""}`} onClick={() => setLiked(false)}>👎 Not really</button>
      </div>

      <span className="setup-q-label">{kind === "workout" ? "Intensity next week?" : "Food next week?"}</span>
      <div className="pill-group" style={{ marginBottom: 10 }}>
        {(["less", "same", "more"] as const).map((t) => (
          <button key={t} className={`pill ${tune === t ? "on" : ""}`} onClick={() => setTune(t)}>
            {tuneLabels[t]}
          </button>
        ))}
      </div>

      <input
        className="field"
        placeholder="Anything else? (optional — e.g. 'more paneer', 'shorter workouts')"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={busy}>
        {busy ? <span className="spinner" /> : "Save — set up next week ›"}
      </button>
    </div>
  );
}
