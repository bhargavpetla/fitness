"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/Toast";
import { LoadingJoke } from "@/components/LoadingJoke";
import { ModeSwitch } from "@/components/ModeSwitch";
import { PlanHeader } from "./PlanHeader";
import { MealDay } from "./MealDay";
import { WorkoutDay } from "./WorkoutDay";
import { fetchActivePlan, fetchPlanDays, setPlanStatus, deletePlan, fetchStreak } from "@/lib/db";
import { todayIndex } from "@/lib/planProgress";
import { setMode, coachUnlocked, unlockProgress, UNLOCK_DAYS } from "@/lib/mode";
import { useLiquidGlass } from "@/lib/liquidGlass";
import { todayStr, prettyDate } from "@/lib/date";
import type { AiPlan, AiPlanDay, PlanKind } from "@/lib/types";

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

  // A full month in one AI call outlasts the serverless window, so the plan is
  // generated in two halves. If the second half fails, the plan survives as
  // partial and "Finish weeks 3–4" resumes it.
  async function callGenerate(part: 1 | 2, planId?: string): Promise<{ plan_id: string }> {
    const res = await fetch("/api/plan/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, part, plan_id: planId }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? "Could not generate the plan.");
    return json as { plan_id: string };
  }

  async function generate() {
    setGenerating("Planning weeks 1–2…");
    try {
      const p1 = await callGenerate(1);
      setGenerating("Weeks 1–2 done. Planning weeks 3–4…");
      try {
        await callGenerate(2, p1.plan_id);
        setToast(kind === "meal" ? "Your 30-day meal plan is ready 🍛" : "Your 30-day training plan is ready 💪");
      } catch {
        setToast("Weeks 1–2 are ready; weeks 3–4 didn't finish. Tap 'Finish plan' to complete it.");
      }
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  async function finishPartial() {
    if (!plan) return;
    setGenerating("Planning weeks 3–4…");
    try {
      await callGenerate(2, plan.id);
      await load();
      setToast("Plan complete — all 30 days ready ✓");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setGenerating(null);
    }
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
        <button className="icon-btn" aria-label="Settings" onClick={() => router.push("/settings")}>
          ⚙
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
            <h2>{kind === "meal" ? "A month of meals, made for you" : "A month of training, built on your lifts"}</h2>
            <p className="muted">
              {kind === "meal"
                ? "The coach reads your last 30 days of logged meals — your staples, your cuisine, your rhythm — and plans the next 30 to hit your goal. Every day: real dishes with photos, portions, macros, and recipes."
                : "The coach studies your last 30 days of workouts and plans the next 30 with progressive overload — small, earned jumps in weight and reps, rest days included. Every exercise comes with its animation."}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Fully optional and separate from your manual logging. Stop or delete it anytime.
            </p>
            <button className="btn btn-primary" onClick={generate}>
              ✨ Generate my 30-day plan
            </button>
          </div>
        ) : (
          <>
            <PlanHeader plan={plan} days={days} onStop={stop} onDelete={remove} onRegenerate={generate} />

            {Boolean((plan.meta as { partial?: boolean } | null)?.partial) && days.length < 30 && (
              <div className="plan-note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span>Weeks 3–4 aren&apos;t generated yet.</span>
                <button className="meal-mini-btn log" onClick={finishPartial}>Finish plan ›</button>
              </div>
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

            {day && (
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
