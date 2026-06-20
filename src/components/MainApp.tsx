"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TopCounter } from "./TopCounter";
import { GoalCountdown } from "./GoalCountdown";
import { AddSheet } from "./AddSheet";
import { Toast } from "./Toast";
import { EntryCard } from "./EntryCard";
import { CalendarView } from "./CalendarView";
import { GuruChat } from "./GuruChat";
import {
  fetchProfile,
  fetchActiveGoal,
  fetchFoodLogs,
  fetchExerciseLogs,
  fetchExerciseConfig,
  fetchStreak,
  fetchWeekExerciseCount,
  addFoodLog,
  addExerciseLog,
  deleteFoodLog,
  deleteExerciseLog,
} from "@/lib/db";
import { uploadPhoto } from "@/lib/photos";
import { normalizeWorkout, totalVolume } from "@/lib/workout";
import { todayStr, addDays, prettyDate, dayNumber, weekStart } from "@/lib/date";
import { liveStreak } from "@/lib/streak";
import { buildNudge } from "@/lib/nudges";
import type { Profile, Goal, FoodLog, ExerciseLog, ExerciseConfig, Streak } from "@/lib/types";

export function MainApp() {
  const router = useRouter();
  const [tab, setTab] = useState<"food" | "exercise">("food");
  const [date, setDate] = useState(todayStr());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [foods, setFoods] = useState<FoodLog[]>([]);
  const [exercises, setExercises] = useState<ExerciseLog[]>([]);
  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [weekSessions, setWeekSessions] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [guruOpen, setGuruOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const isToday = date === todayStr();

  // Live clock for the header.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Midnight roll-over: track the calendar day; when it advances, if the user is
  // parked on the previous day's "today", snap them to the new day automatically.
  const lastTodayRef = useRef(todayStr());
  useEffect(() => {
    const t = todayStr(now);
    if (t !== lastTodayRef.current) {
      const wasOnOldToday = date === lastTodayRef.current;
      lastTodayRef.current = t;
      if (wasOnOldToday) setDate(t);
    }
  }, [now, date]);

  const loadStatic = useCallback(async () => {
    const [p, g, c, s] = await Promise.all([
      fetchProfile(),
      fetchActiveGoal(),
      fetchExerciseConfig(),
      fetchStreak(),
    ]);
    setProfile(p);
    setGoal(g);
    setCfg(c);
    setStreak(s);
    setWeekSessions(await fetchWeekExerciseCount(weekStart()));
  }, []);

  const loadDay = useCallback(async () => {
    const [f, e] = await Promise.all([fetchFoodLogs(date), fetchExerciseLogs(date)]);
    setFoods(f);
    setExercises(e);
  }, [date]);

  useEffect(() => {
    loadStatic();
  }, [loadStatic]);
  useEffect(() => {
    loadDay();
  }, [loadDay]);

  // One gentle nudge a day, on the food tab, today only.
  useEffect(() => {
    if (!isToday || !profile) return;
    const n = buildNudge({ profile, goal, foods, weekSessions, cfg, streak });
    if (n) {
      setToast(n);
      const t = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, [isToday, profile, goal, foods, weekSessions, cfg, streak]);

  const consumed = useMemo(
    () =>
      foods.reduce(
        (a, f) => ({
          calories: a.calories + Number(f.calories),
          protein_g: a.protein_g + Number(f.protein_g),
          carbs_g: a.carbs_g + Number(f.carbs_g),
          fat_g: a.fat_g + Number(f.fat_g),
        }),
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      ),
    [foods]
  );

  const day = profile ? dayNumber(profile.start_date, isToday ? todayStr() : date) : 1;
  const streakN = liveStreak(streak);

  async function loadInsight() {
    setInsightBusy(true);
    try {
      const res = await fetch("/api/exercise/insight", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error ?? "Could not load insight.");
      } else {
        setInsight(json.insight);
      }
    } finally {
      setInsightBusy(false);
    }
  }

  return (
    <div className="app-shell">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="topbar">
        <div>
          {profile?.first_name && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 600 }}>
              {greeting()}, {profile.first_name}
            </div>
          )}
          <span className="daycount">Day {day}</span>
          <div style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            {" · "}
            {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <span className={`flame ${streakN > 0 ? "active" : ""}`}>🔥 {streakN}</span>
        <button className="icon-btn" aria-label="Settings" onClick={() => router.push("/settings")}>
          ⚙
        </button>
      </div>

      <TopCounter
        mode={tab}
        goal={goal}
        consumed={consumed}
        sessions={weekSessions}
        sessionTarget={cfg?.weekly_target_sessions ?? 4}
      />

      {tab === "food" && isToday && <GoalCountdown profile={profile} goal={goal} />}

      <div className="tabs">
        <button className={`tab ${tab === "food" ? "active" : ""}`} onClick={() => setTab("food")}>
          Food
        </button>
        <button className={`tab ${tab === "exercise" ? "active" : ""}`} onClick={() => setTab("exercise")}>
          Exercise
        </button>
      </div>

      <div className="content">
        <div className="datebar">
          <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <span>{prettyDate(date)}</span>
          <button onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day">›</button>
          <button onClick={() => setCalendarOpen(true)} aria-label="Calendar view" title="Calendar / summary">📅</button>
        </div>

        {tab === "food" ? (
          <FoodList
            foods={foods}
            onDelete={async (id) => {
              await deleteFoodLog(id);
              loadDay();
            }}
          />
        ) : (
          <ExerciseList
            exercises={exercises}
            cfg={cfg}
            insight={insight}
            insightBusy={insightBusy}
            onInsight={loadInsight}
            onOpen={(id) => router.push(`/workout/${id}`)}
            onDelete={async (id) => {
              await deleteExerciseLog(id);
              loadDay();
              setWeekSessions(await fetchWeekExerciseCount(weekStart()));
            }}
          />
        )}
      </div>

      <div className="add-bar">
        <button className="btn-add" onClick={() => setSheet(true)}>
          + Add {tab === "food" ? "meal" : "workout"}
        </button>
        {tab === "food" && (
          <button className="btn-guru" onClick={() => setGuruOpen(true)} aria-label="Ask the AI Guru" title="Ask the Guru">
            ✨
          </button>
        )}
      </div>

      {sheet && (
        <AddSheet
          mode={tab}
          onClose={() => setSheet(false)}
          onSaveFood={async ({ meal_label, raw_input, result, photoDataUrl }) => {
            let photo_url: string | null = null;
            if (photoDataUrl) photo_url = await uploadPhoto(photoDataUrl, "food");
            await addFoodLog({
              date,
              meal_label,
              raw_input,
              items: result.items,
              totals: result.totals,
              vitamins: result.vitamins,
              photo_url,
            });
            await loadDay();
            await refreshStreak();
          }}
          onSaveExercise={async ({ raw_input, parsed }) => {
            await addExerciseLog({ date, parsed, raw_input });
            await loadDay();
            setWeekSessions(await fetchWeekExerciseCount(weekStart()));
            await refreshStreak();
          }}
        />
      )}

      {calendarOpen && (
        <CalendarView
          goal={goal}
          onClose={() => setCalendarOpen(false)}
          onPickDate={(d) => {
            setDate(d);
            setCalendarOpen(false);
          }}
        />
      )}

      {guruOpen && <GuruChat name={profile?.first_name ?? null} onClose={() => setGuruOpen(false)} />}
    </div>
  );

  async function refreshStreak() {
    setStreak(await fetchStreak());
  }
}

// ---------- food list ----------
function FoodList({ foods, onDelete }: { foods: FoodLog[]; onDelete: (id: string) => void }) {
  if (foods.length === 0) {
    return (
      <div className="center-screen" style={{ padding: "30px 20px" }}>
        <div style={{ fontSize: 34 }}>🍽️</div>
        <p className="muted">No meals logged yet. Tap + to add one.</p>
      </div>
    );
  }
  return (
    <>
      {foods.map((f) => (
        <EntryCard key={f.id} food={f} onDelete={() => onDelete(f.id)} />
      ))}
    </>
  );
}

// ---------- exercise list ----------
function ExerciseList({
  exercises,
  cfg,
  insight,
  insightBusy,
  onInsight,
  onOpen,
  onDelete,
}: {
  exercises: ExerciseLog[];
  cfg: ExerciseConfig | null;
  insight: string | null;
  insightBusy: boolean;
  onInsight: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="pill" onClick={onInsight} disabled={insightBusy}>
          {insightBusy ? <span className="spinner" style={{ borderTopColor: "var(--accent)" }} /> : "ⓘ Insight"}
        </button>
      </div>
      {insight && (
        <div className="card" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)", whiteSpace: "pre-wrap" }}>
          {insight}
        </div>
      )}
      {exercises.length === 0 ? (
        <div className="center-screen" style={{ padding: "30px 20px" }}>
          <div style={{ fontSize: 34 }}>🏋️</div>
          <p className="muted">No workout logged. Even a rest day counts.</p>
          {cfg?.split_pattern && <p className="muted" style={{ fontSize: 13 }}>Pattern: {cfg.split_pattern}</p>}
        </div>
      ) : (
        exercises.map((e) => {
          if (e.type !== "strength") {
            return (
              <div key={e.id} className={`card ${e.type === "rest" ? "rest" : ""}`} onClick={() => confirmDelete(e.id, onDelete)}>
                <div className="card-top">
                  <div className="meal">{e.type === "cardio" ? "🏃 Cardio" : e.type === "rest" ? "😌 Rest day" : "Other"}</div>
                  {e.est_calories != null && <div className="kcal">~{Math.round(Number(e.est_calories))} kcal</div>}
                </div>
                <div className="sub">{e.parsed_json?.summary || e.raw_input}</div>
              </div>
            );
          }
          const ex = normalizeWorkout(e.parsed_json);
          const vol = totalVolume(ex);
          const groups = e.parsed_json?.muscle_groups ?? [];
          return (
            <div key={e.id} className="card wd-summary" onClick={() => onOpen(e.id)}>
              <div className="card-top">
                <div>
                  <div className="meal">{e.parsed_json?.workout_name || "Strength"} 💪</div>
                  {groups.length > 0 && <div className="sub">{groups.join(" · ")}</div>}
                </div>
                <button
                  className="icon-btn"
                  style={{ color: "#b42318", flex: "0 0 auto" }}
                  onClick={(ev) => { ev.stopPropagation(); confirmDelete(e.id, onDelete); }}
                  aria-label="Delete workout"
                >×</button>
              </div>
              <div className="wd-summary-meta">
                <span>{ex.length} exercises</span>
                <span>{vol.toLocaleString()} kg volume</span>
                {e.est_calories != null && <span>~{Math.round(Number(e.est_calories))} kcal</span>}
              </div>
              <div className="wd-summary-open">View details ›</div>
            </div>
          );
        })
      )}
    </>
  );
}

function confirmDelete(id: string, onDelete: (id: string) => void) {
  if (confirm("Delete this entry?")) onDelete(id);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
