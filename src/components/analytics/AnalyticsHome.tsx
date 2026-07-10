"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Icon } from "@/components/Icon";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { fetchDailyTotals, fetchActiveGoal, fetchExerciseSince, fetchWeighInsSince, fetchProfile, fetchStreak } from "@/lib/db";
import { normalizeWorkout, muscleGroupOf, totalVolume, totalSets, totalReps } from "@/lib/workout";
import { todayStr, addDays } from "@/lib/date";
import type { Goal, ExerciseLog, Profile, Streak } from "@/lib/types";

// WHOOP-style analytics: two big scores, then trends — graphs first, words
// last. Everything on this page is computed locally from the logs, so it's
// free, instant, and always honest. Plus personalised body metrics (BMI, BMR,
// maintenance calories) and a few fun cumulative stats.

const ACCENT = "#2f7a4d";
const CARBS = "#e0a458";
const FAT = "#7c6ae0";
const INK2 = "#86868b";

// Mifflin–St Jeor activity multipliers, keyed to the profile's activity level.
const ACTIVITY: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
};

// Non-judgemental BMI banding (WHO cut-offs) with a marker position on a
// 15–35 scale for the little gauge.
function bmiInfo(bmi: number): { label: string; color: string; pos: number } {
  const pos = Math.max(2, Math.min(98, ((bmi - 15) / 20) * 100));
  if (bmi < 18.5) return { label: "Underweight", color: "#5aa9e6", pos };
  if (bmi < 25) return { label: "Healthy range", color: "#16a34a", pos };
  if (bmi < 30) return { label: "Above range", color: "#e8963e", pos };
  return { label: "Well above range", color: "#e0654a", pos };
}

// A playful, relatable equivalent for a big pile of kilograms moved.
function funMass(kg: number): string {
  const refs = [
    { kg: 6000, one: "elephant", emoji: "🐘" },
    { kg: 1500, one: "car", emoji: "🚗" },
    { kg: 450, one: "piano", emoji: "🎹" },
    { kg: 100, one: "panda", emoji: "🐼" },
    { kg: 12, one: "bowling ball", emoji: "🎳" },
  ];
  for (const r of refs) {
    const n = kg / r.kg;
    if (n >= 1) return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${r.one}${n >= 2 ? "s" : ""} ${r.emoji}`;
  }
  return "a solid warm-up 💪";
}

interface DayRow {
  date: string;
  calories: number;
  protein_g: number;
}

export function AnalyticsHome() {
  const router = useRouter();
  const [rows, setRows] = useState<DayRow[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [exLogs, setExLogs] = useState<ExerciseLog[]>([]);
  const [weights, setWeights] = useState<Array<{ date: string; weight_kg: number }>>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [loading, setLoading] = useState(true);

  const today = todayStr();
  const from28 = addDays(today, -27);
  const from42 = addDays(today, -41);

  useEffect(() => {
    Promise.all([
      fetchDailyTotals(from28, today),
      fetchActiveGoal(),
      fetchExerciseSince(from42),
      fetchWeighInsSince(addDays(today, -59)),
      fetchProfile(),
      fetchStreak(),
    ])
      .then(([r, g, e, w, p, s]) => {
        setRows(r);
        setGoal(g);
        setExLogs(e);
        setWeights(w);
        setProfile(p);
        setStreak(s);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDate = useMemo(() => new Map(rows.map((r) => [r.date, r])), [rows]);

  // ---- last-14-day nutrition series (missing days shown as gaps at 0) ----
  const series14 = useMemo(() => {
    const out: Array<{ d: string; kcal: number; p: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const date = addDays(today, -i);
      const r = byDate.get(date);
      out.push({ d: date.slice(8), kcal: Math.round(r?.calories ?? 0), p: Math.round(r?.protein_g ?? 0) });
    }
    return out;
  }, [byDate, today]);

  // ---- training aggregates ----
  const strength = useMemo(() => exLogs.filter((l) => l.type === "strength" && l.parsed_json), [exLogs]);

  const weeklyVolume = useMemo(() => {
    // 6 buckets of 7 days, oldest first.
    const buckets: Array<{ w: string; vol: number; sessions: number }> = [];
    for (let b = 5; b >= 0; b--) {
      const start = addDays(today, -(b * 7 + 6));
      const end = addDays(today, -b * 7);
      const logs = strength.filter((l) => l.date >= start && l.date <= end);
      const vol = logs.reduce((a, l) => a + totalVolume(normalizeWorkout(l.parsed_json)), 0);
      buckets.push({ w: b === 0 ? "now" : `-${b}w`, vol: Math.round(vol), sessions: new Set(logs.map((l) => l.date)).size });
    }
    return buckets;
  }, [strength, today]);

  const muscleShare = useMemo(() => {
    const cutoff = addDays(today, -29);
    const byMuscle = new Map<string, number>();
    for (const l of strength) {
      if (l.date < cutoff) continue;
      for (const e of normalizeWorkout(l.parsed_json)) {
        const g = muscleGroupOf(e.primaryMuscle);
        byMuscle.set(g, (byMuscle.get(g) ?? 0) + (e.volume || 1));
      }
    }
    const total = [...byMuscle.values()].reduce((a, b) => a + b, 0) || 1;
    return [...byMuscle.entries()]
      .map(([m, v]) => ({ m, pct: Math.round((v / total) * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 7);
  }, [strength, today]);

  // ---- scores ----
  const nutritionScore = useMemo(() => {
    const last7: DayRow[] = [];
    for (let i = 6; i >= 0; i--) {
      const r = byDate.get(addDays(today, -i));
      if (r) last7.push(r);
    }
    if (last7.length === 0) return 0;
    if (!goal) return Math.round((last7.length / 7) * 100);
    const closeness = last7.map((r) => Math.max(0, 1 - (Math.abs(r.calories - goal.calories) / goal.calories) * 2.5));
    const proteinHits = last7.filter((r) => r.protein_g >= goal.protein_g * 0.9).length;
    return Math.round(((closeness.reduce((a, b) => a + b, 0) / last7.length) * 0.7 + (proteinHits / last7.length) * 0.3) * 100);
  }, [byDate, goal, today]);

  const trainingScore = useMemo(() => {
    const cur = weeklyVolume[5];
    const past = weeklyVolume.slice(1, 5); // previous 4 full weeks
    const avgVol = past.reduce((a, b) => a + b.vol, 0) / (past.filter((b) => b.vol > 0).length || 1);
    const sessionsPart = Math.min(1, cur.sessions / 4) * 60;
    const volPart = avgVol > 0 ? Math.min(1, cur.vol / avgVol) * 40 : cur.sessions > 0 ? 40 : 0;
    return Math.round(sessionsPart + volPart);
  }, [weeklyVolume]);

  // ---- consistency grid (last 28 days) ----
  const grid = useMemo(() => {
    const trainedDays = new Set(exLogs.filter((l) => l.type !== "rest").map((l) => l.date));
    const restDays = new Set(exLogs.filter((l) => l.type === "rest").map((l) => l.date));
    const out: Array<{ date: string; food: boolean; train: boolean; rest: boolean }> = [];
    for (let i = 27; i >= 0; i--) {
      const date = addDays(today, -i);
      out.push({ date, food: byDate.has(date), train: trainedDays.has(date), rest: restDays.has(date) });
    }
    return out;
  }, [byDate, exLogs, today]);

  // ---- focus insights (few words, computed) ----
  const focus = useMemo(() => {
    const out: Array<{ icon: string; text: string }> = [];
    if (goal) {
      const hits = series14.slice(7).filter((d) => d.p >= goal.protein_g * 0.9).length;
      if (hits < 5) out.push({ icon: "restaurant-outline", text: `Protein ${hits}/7 days — front-load it` });
    }
    const volNow = weeklyVolume[5]?.vol ?? 0;
    const volPrev = weeklyVolume[4]?.vol ?? 0;
    if (volPrev > 0) {
      const d = Math.round(((volNow - volPrev) / volPrev) * 100);
      out.push({ icon: "barbell-outline", text: d >= 0 ? `Volume +${d}% vs last week` : `Volume ${d}% — rebuild this week` });
    }
    const legs = muscleShare.find((m) => /quads|hamstrings|glutes/i.test(m.m));
    const back = muscleShare.find((m) => /back|lats/i.test(m.m));
    if (muscleShare.length >= 3 && !legs) out.push({ icon: "flame-outline", text: "Legs missing this month" });
    else if (muscleShare.length >= 3 && !back) out.push({ icon: "flame-outline", text: "Pull work missing this month" });
    const loggedDays = grid.filter((g) => g.food || g.train).length;
    if (loggedDays < 20) out.push({ icon: "keypad-outline", text: `${loggedDays}/28 days logged` });
    return out.slice(0, 3);
  }, [goal, series14, weeklyVolume, muscleShare, grid]);

  const weightSeries = useMemo(
    () => weights.map((w) => ({ d: w.date.slice(5), kg: w.weight_kg })),
    [weights]
  );

  // ---- personalised body metrics ----
  const latestWeight = weights.length ? weights[weights.length - 1].weight_kg : null;

  const bmi = useMemo(() => {
    if (!latestWeight || !profile?.height_cm) return null;
    const h = profile.height_cm / 100;
    return latestWeight / (h * h);
  }, [latestWeight, profile]);

  const energy = useMemo(() => {
    if (!latestWeight || !profile?.height_cm || !profile?.age) return null;
    const base = 10 * latestWeight + 6.25 * profile.height_cm - 5 * profile.age;
    // Mifflin–St Jeor; the "unspecified" sex splits the +5 / −161 offset.
    const bmr = profile.sex === "male" ? base + 5 : profile.sex === "female" ? base - 161 : base - 78;
    const factor = ACTIVITY[profile.activity_level ?? "moderate"] ?? 1.55;
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * factor) };
  }, [latestWeight, profile]);

  // ---- fun cumulative stats (last 30 days of training + all-time streak) ----
  const funStats = useMemo(() => {
    const cutoff = addDays(today, -29);
    const recent = strength.filter((l) => l.date >= cutoff);
    let vol = 0, sets = 0, reps = 0;
    for (const l of recent) {
      const ex = normalizeWorkout(l.parsed_json);
      vol += totalVolume(ex);
      sets += totalSets(ex);
      reps += totalReps(ex);
    }
    const burned = exLogs
      .filter((l) => l.date >= cutoff && l.est_calories != null)
      .reduce((a, l) => a + Number(l.est_calories), 0);
    const workouts = new Set(recent.map((l) => l.date)).size;
    return { vol, sets, reps, burned: Math.round(burned), workouts };
  }, [strength, exLogs, today]);

  const loggedThisMonth = grid.filter((g) => g.food || g.train).length;
  const introLine = streak && streak.current_streak > 0
    ? `${streak.current_streak}-day streak 🔥 · ${loggedThisMonth}/28 days logged this month`
    : `${loggedThisMonth}/28 days logged this month — keep it rolling`;

  return (
    <div className="app-shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => router.back()} aria-label="Back">
          <Icon name="chevron-back-outline" />
        </button>
        <span className="daycount">Analytics</span>
        <span style={{ width: 38 }} />
      </div>

      <div className="content an">
        {loading ? (
          <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
        ) : (
          <>
            {/* personalised intro */}
            <div className="an-intro">
              <h1 className="an-intro-title">{profile?.first_name ? `${profile.first_name}'s month` : "Your month"}</h1>
              <p className="an-intro-sub">{introLine}</p>
            </div>

            {/* scores hero */}
            <div className="an-hero">
              <ScoreRing label="Nutrition" score={nutritionScore} color="#7ee2a8" />
              <ScoreRing label="Training" score={trainingScore} color="#b7a5ff" />
            </div>

            {/* focus chips */}
            {focus.length > 0 && (
              <div className="an-focus">
                {focus.map((f, i) => (
                  <span key={i} className="an-focus-chip"><Icon name={f.icon} size={14} /> {f.text}</span>
                ))}
              </div>
            )}

            {/* body metrics — personalised (BMI, resting + maintenance calories) */}
            {profile && (
              <section className="an-card">
                <div className="an-card-head">
                  <Icon name="sparkles-outline" size={16} />
                  <span>Body</span>
                  {latestWeight && <span className="an-kpi">{latestWeight} kg</span>}
                </div>
                {bmi ? (
                  <div className="an-bmi">
                    <div className="an-bmi-top">
                      <span className="an-bmi-num" style={{ color: bmiInfo(bmi).color }}>{bmi.toFixed(1)}</span>
                      <span className="an-bmi-cap">BMI · <b style={{ color: bmiInfo(bmi).color }}>{bmiInfo(bmi).label}</b></span>
                    </div>
                    <div className="an-bmi-scale">
                      <span className="an-bmi-marker" style={{ left: `${bmiInfo(bmi).pos}%` }} />
                    </div>
                    <div className="an-bmi-ticks"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>35</span></div>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: 13, margin: "0 0 2px" }}>
                    Log a weigh-in{profile.height_cm ? "" : " and add your height in settings"} to unlock your BMI.
                  </p>
                )}
                {energy && (
                  <div className="an-energy">
                    <div className="an-energy-cell">
                      <span className="an-energy-val">{energy.bmr.toLocaleString()}</span>
                      <span className="an-energy-label">BMR · resting burn</span>
                    </div>
                    <div className="an-energy-cell">
                      <span className="an-energy-val">{energy.tdee.toLocaleString()}</span>
                      <span className="an-energy-label">Maintenance · with activity</span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* calories trend */}
            <section className="an-card">
              <div className="an-card-head">
                <Icon name="flame-outline" size={16} />
                <span>Calories · 14d</span>
                {goal && <span className="an-kpi"><AnimatedNumber value={Math.round(goal.calories)} /> goal</span>}
              </div>
              <div className="an-chart">
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={series14} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="calfill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis hide domain={[0, "dataMax + 300"]} />
                    {goal && <ReferenceLine y={goal.calories} stroke={INK2} strokeDasharray="4 4" />}
                    <Area type="monotone" dataKey="kcal" stroke={ACCENT} strokeWidth={2.5} fill="url(#calfill)" animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* protein trend */}
            <section className="an-card">
              <div className="an-card-head">
                <Icon name="restaurant-outline" size={16} />
                <span>Protein · 14d</span>
                {goal && <span className="an-kpi"><AnimatedNumber value={Math.round(goal.protein_g)} />g goal</span>}
              </div>
              <div className="an-chart">
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart data={series14} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis hide domain={[0, "dataMax + 30"]} />
                    {goal && <ReferenceLine y={goal.protein_g} stroke={INK2} strokeDasharray="4 4" />}
                    <Bar dataKey="p" radius={[5, 5, 0, 0]} animationDuration={800}>
                      {series14.map((d, i) => (
                        <Cell key={i} fill={goal && d.p >= goal.protein_g * 0.9 ? ACCENT : "#cfd8d2"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* training volume */}
            <section className="an-card">
              <div className="an-card-head">
                <Icon name="barbell-outline" size={16} />
                <span>Volume · 6w</span>
                <span className="an-kpi"><AnimatedNumber value={weeklyVolume[5]?.vol ?? 0} /> kg</span>
              </div>
              <div className="an-chart">
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart data={weeklyVolume} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="w" tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, "dataMax + 500"]} />
                    <Bar dataKey="vol" radius={[5, 5, 0, 0]} animationDuration={800}>
                      {weeklyVolume.map((d, i) => (
                        <Cell key={i} fill={i === 5 ? FAT : "#ddd6f8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* muscle focus */}
            {muscleShare.length > 0 && (
              <section className="an-card">
                <div className="an-card-head">
                  <Icon name="stats-chart-outline" size={16} />
                  <span>Muscle focus · 30d</span>
                </div>
                {muscleShare.map((m) => (
                  <div key={m.m} className="wd-dist-row">
                    <span className="wd-dist-name">{m.m}</span>
                    <div className="wd-dist-bar"><div className="wd-dist-fill an-grow" style={{ width: `${Math.max(4, m.pct)}%`, background: FAT }} /></div>
                    <span className="wd-dist-val">{m.pct}%</span>
                  </div>
                ))}
              </section>
            )}

            {/* weight trend */}
            {weightSeries.length >= 2 && (
              <section className="an-card">
                <div className="an-card-head">
                  <Icon name="stats-chart-outline" size={16} />
                  <span>Weight · 60d</span>
                  <span className="an-kpi">{weightSeries[weightSeries.length - 1].kg} kg</span>
                </div>
                <div className="an-chart">
                  <ResponsiveContainer width="100%" height={100}>
                    <LineChart data={weightSeries} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="d" tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                      <Line type="monotone" dataKey="kg" stroke={CARBS} strokeWidth={2.5} dot={false} animationDuration={800} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* fun cumulative stats */}
            {(funStats.workouts > 0 || (streak && streak.total_days_logged > 0)) && (
              <section className="an-card">
                <div className="an-card-head">
                  <Icon name="trophy-outline" size={16} />
                  <span>Fun stats · 30d</span>
                </div>
                {funStats.vol > 0 && (
                  <div className="an-funhero">
                    <span className="an-funhero-big">{funMass(funStats.vol)}</span>
                    <span className="an-funhero-sub">total lifted · {funStats.vol.toLocaleString()} kg moved in 30 days</span>
                  </div>
                )}
                <div className="an-funstats">
                  <FunTile value={String(funStats.workouts)} label="workouts" />
                  <FunTile value={funStats.sets.toLocaleString()} label="sets" />
                  <FunTile value={funStats.reps.toLocaleString()} label="reps" />
                  <FunTile value={funStats.burned.toLocaleString()} label="kcal burned" />
                  {streak && <FunTile value={`${streak.longest_streak} 🔥`} label="best streak" />}
                  {streak && <FunTile value={String(streak.total_days_logged)} label="days logged" />}
                </div>
              </section>
            )}

            {/* consistency grid */}
            <section className="an-card">
              <div className="an-card-head">
                <Icon name="calendar-outline" size={16} />
                <span>Consistency · 28d</span>
                <span className="an-kpi">{grid.filter((g) => g.food || g.train).length}/28</span>
              </div>
              <div className="an-grid">
                {grid.map((g) => (
                  <span
                    key={g.date}
                    className={`an-dot ${g.food && g.train ? "both" : g.train ? "train" : g.rest ? "rest" : g.food ? "food" : ""}`}
                    title={g.date}
                  />
                ))}
              </div>
              <div className="an-legend">
                <span><i className="an-dot food" /> food</span>
                <span><i className="an-dot train" /> trained</span>
                <span><i className="an-dot both" /> both</span>
                <span><i className="an-dot rest" /> rest</span>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// One small stat tile in the fun-stats grid.
function FunTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="an-funtile">
      <span className="an-funtile-val">{value}</span>
      <span className="an-funtile-label">{label}</span>
    </div>
  );
}

// Big animated ring gauge — the WHOOP-style headline numbers.
function ScoreRing({ label, score, color }: { label: string; score: number; color: string }) {
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(score), 60);
    return () => clearTimeout(t);
  }, [score]);
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="an-ring">
      <svg width={128} height={128} viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C - (C * Math.min(100, drawn)) / 100}
          transform="rotate(-90 64 64)"
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 0.61, 0.36, 1)" }}
        />
      </svg>
      <div className="an-ring-mid">
        <span className="an-ring-num"><AnimatedNumber value={score} /></span>
        <span className="an-ring-label">{label}</span>
      </div>
    </div>
  );
}
