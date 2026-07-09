"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchExerciseLogById, fetchStrengthHistory, fetchProfile } from "@/lib/db";
import {
  normalizeWorkout,
  strengthLogsToWorkouts,
  totalVolume,
  totalSets,
  strengthScore,
  intensity,
  progressiveOverload,
  muscleActivation,
  personalRecords,
  compareExercise,
  type NormalizedExercise,
} from "@/lib/workout";
import { getExerciseImage } from "@/lib/exerciseImage";
import { BodyMap } from "@/components/BodyMap";
import { prettyDate } from "@/lib/date";
import type { ExerciseLog, Profile, WorkoutIntelligence } from "@/lib/types";

export default function WorkoutDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [log, setLog] = useState<ExerciseLog | null>(null);
  const [history, setHistory] = useState<ExerciseLog[]>([]);
  const [, setProfile] = useState<Profile | null>(null);
  const [intel, setIntel] = useState<WorkoutIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [intelBusy, setIntelBusy] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [l, h, p] = await Promise.all([fetchExerciseLogById(id), fetchStrengthHistory(60), fetchProfile()]);
      setLog(l);
      setHistory(h);
      setProfile(p);
      setIntel(l?.parsed_json?.intelligence ?? null);
      setLoading(false);
    })();
  }, [id]);

  // Auto-load the AI intelligence once (server caches it, so re-opens are free).
  useEffect(() => {
    if (!log || log.type !== "strength") return;
    if (log.parsed_json?.intelligence?.narrative) return;
    loadIntelligence(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  async function loadIntelligence(force: boolean) {
    if (!id) return;
    setIntelBusy(true);
    try {
      const res = await fetch("/api/exercise/intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logId: id, force }),
      });
      const json = await res.json();
      if (res.ok && json.intelligence) setIntel(json.intelligence);
    } finally {
      setIntelBusy(false);
    }
  }

  const current = useMemo(() => normalizeWorkout(log?.parsed_json ?? null), [log]);

  // Previous strength session (older than this one) for overload + per-exercise deltas.
  const prev = useMemo(() => {
    const workouts = strengthLogsToWorkouts(history).filter((w) => w.id !== id && w.date <= (log?.date ?? "9999"));
    const older = workouts.filter((w) => w.date < (log?.date ?? "9999"));
    return older[0]?.exercises ?? null;
  }, [history, id, log]);

  const pastWorkouts = useMemo(
    () => strengthLogsToWorkouts(history).filter((w) => w.id !== id).map((w) => w.exercises),
    [history, id]
  );

  if (loading) {
    return (
      <div className="app-shell">
        <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
      </div>
    );
  }

  if (!log || log.type !== "strength" || !current.length) {
    return (
      <div className="app-shell">
        <DetailTopBar onBack={() => router.back()} />
        <div className="center-screen" style={{ padding: 30 }}>
          <p className="muted">This workout has no details to show.</p>
          <button className="btn btn-ghost" onClick={() => router.back()}>Go back</button>
        </div>
      </div>
    );
  }

  const parsed = log.parsed_json!;
  const vol = totalVolume(current);
  const score = strengthScore(current);
  const sets = totalSets(current);
  const overload = progressiveOverload(current, prev);
  const activation = muscleActivation(current);
  const prs = personalRecords(current, pastWorkouts);
  const intens = intensity(current);
  const when = new Date(log.created_at);

  return (
    <div className="app-shell">
      <DetailTopBar onBack={() => router.back()} />

      <div className="content wd">
        {/* Header */}
        <div className="wd-head">
          <div className="wd-head-icon">🏋️</div>
          <div>
            <h1 className="wd-title">{parsed.workout_name || "Workout"} 💪</h1>
            <div className="wd-sub">{(parsed.muscle_groups ?? []).join(" · ")}</div>
          </div>
        </div>

        {/* Stat chips */}
        <div className="wd-chips">
          <StatChip icon="📅" big={prettyDate(log.date)} small={when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} />
          <StatChip icon="⏱" big={`${parsed.est_duration_min ?? "—"} min`} small="Duration" />
          <StatChip icon="🔥" big={`${parsed.est_calories != null ? Math.round(Number(parsed.est_calories)) : "—"} kcal`} small="Estimated" />
        </div>

        {/* Muscle Focus */}
        <section className="wd-card">
          <h3 className="wd-h3">Muscle Focus</h3>
          <div className="wd-focus">
            <BodyMap activation={activation} />
            <div className="wd-focus-list">
              {activation.slice(0, 6).map((a) => (
                <div key={a.muscle} className="wd-focus-row">
                  <span className="wd-dot" style={{ background: dotColor(a.pct) }} />
                  <span className="wd-focus-name">{a.muscle}</span>
                  <span className="wd-focus-pct">{a.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Performance Summary */}
        <section className="wd-card">
          <h3 className="wd-h3">Performance Summary</h3>
          <div className="wd-perf">
            <PerfCell icon="💪" value={`${score}`} unit="/100" label="Strength Score" />
            <PerfCell
              icon="📈"
              value={overload.pct == null ? "—" : `${overload.pct > 0 ? "+" : ""}${overload.pct}%`}
              label="Progressive Overload"
              good={overload.pct != null && overload.pct >= 0}
            />
            <PerfCell icon="🏋️" value={vol.toLocaleString()} unit="kg" label="Total Volume" />
            <PerfCell icon="⚡" value={intens} label={`Intensity · ${sets} sets`} />
          </div>
        </section>

        {/* Exercise Breakdown */}
        <section className="wd-card">
          <h3 className="wd-h3">Exercise Breakdown</h3>
          {current.map((e, i) => (
            <ExerciseCard
              key={i}
              index={i + 1}
              exercise={e}
              insight={intel?.exercise_insights?.[e.name]}
              insightBusy={intelBusy && !intel}
              comparison={prev ? compareExercise(e, prev) : null}
            />
          ))}
        </section>

        {/* Muscle Volume Distribution */}
        <section className="wd-card">
          <h3 className="wd-h3">Muscle Volume Distribution</h3>
          {activation.map((a) => (
            <div key={a.muscle} className="wd-dist-row">
              <span className="wd-dist-name">{a.muscle}</span>
              <div className="wd-dist-bar"><div className="wd-dist-fill" style={{ width: `${a.pct}%`, background: dotColor(a.pct) }} /></div>
              <span className="wd-dist-val">{a.volume.toLocaleString()} kg</span>
            </div>
          ))}
        </section>

        {/* Personal Records */}
        {prs.length > 0 && (
          <section className="wd-card">
            <h3 className="wd-h3">🏆 Personal Records</h3>
            <div className="wd-pr-grid">
              {prs.map((pr, i) => (
                <div key={i} className="wd-pr">
                  <div className="wd-pr-label">🏅 {pr.exercise}</div>
                  <div className="wd-pr-sub">{pr.label}</div>
                  <div className="wd-pr-val">{pr.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI Coach */}
        <section className="wd-card">
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => { setShowNarrative(true); if (!intel?.narrative) loadIntelligence(false); }} disabled={intelBusy}>
            {intelBusy && !intel?.narrative ? <span className="spinner" /> : "✨ Explain My Workout"}
          </button>
          {showNarrative && intel?.narrative && (
            <div className="wd-narrative">{intel.narrative}</div>
          )}
          {intel?.recovery && (
            <div className="wd-recovery">
              <div className="wd-recovery-h">🍽️ Recovery</div>
              <p>{intel.recovery}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DetailTopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="topbar">
      <button className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
      <span className="daycount">Workout Details</span>
      <span style={{ width: 38 }} />
    </div>
  );
}

function StatChip({ icon, big, small }: { icon: string; big: string; small: string }) {
  return (
    <div className="wd-chip">
      <div className="wd-chip-icon">{icon}</div>
      <div className="wd-chip-big">{big}</div>
      <div className="wd-chip-small">{small}</div>
    </div>
  );
}

function PerfCell({ icon, value, unit, label, good }: { icon: string; value: string; unit?: string; label: string; good?: boolean }) {
  return (
    <div className="wd-perf-cell">
      <div className="wd-perf-icon">{icon}</div>
      <div className="wd-perf-value" style={good ? { color: "var(--accent)" } : undefined}>
        {value}{unit && <span className="wd-perf-unit"> {unit}</span>}
      </div>
      <div className="wd-perf-label">{label}</div>
    </div>
  );
}

function ExerciseCard({
  index,
  exercise,
  insight,
  insightBusy,
  comparison,
}: {
  index: number;
  exercise: NormalizedExercise;
  insight?: string;
  insightBusy: boolean;
  comparison: ReturnType<typeof compareExercise> | null;
}) {
  // Live-logged exercises carry their library media key — show the real
  // animation. Typed workouts fall back to the AI-generated illustration.
  const [img, setImg] = useState<string | null>(
    exercise.media ? `/exercise-media/videos/${exercise.media}.gif` : null
  );
  useEffect(() => {
    if (exercise.media) return;
    let on = true;
    getExerciseImage(exercise.name, exercise.primaryMuscle).then((u) => on && setImg(u));
    return () => { on = false; };
  }, [exercise.name, exercise.primaryMuscle, exercise.media]);

  const muscleLabel = [exercise.primaryMuscle, ...exercise.secondaryMuscles].filter(Boolean).slice(0, 2).join(" · ");

  return (
    <div className="wd-ex">
      <div className="wd-ex-top">
        <div className="wd-ex-thumb">
          {img ? <img src={img} alt="" /> : <span className="wd-ex-thumb-ph">🏋️</span>}
        </div>
        <div className="wd-ex-headtext">
          <div className="wd-ex-name"><span className="wd-ex-num">{index}</span> {exercise.name}</div>
          <div className="wd-ex-muscle">{muscleLabel}</div>
        </div>
      </div>

      <div className="wd-sets">
        {exercise.sets.map((s, i) => (
          <div key={i} className="wd-set-row">
            <span className="wd-set-label">Set {i + 1}</span>
            <span className="wd-set-weight">{s.weight_kg == null ? "Bodyweight" : `${s.weight_kg} kg${s.each_side ? " each" : ""}`}</span>
            <span className="wd-set-reps">{s.reps} reps</span>
          </div>
        ))}
      </div>

      <div className="wd-ex-foot">
        <div className="wd-ex-vol">
          <span className="wd-ex-vol-label">Volume</span>
          <span className="wd-ex-vol-val">{exercise.volume.toLocaleString()} kg</span>
        </div>
        {comparison?.found && comparison.improved && (
          <span className="wd-improve">
            ↑ {comparison.repDelta && comparison.repDelta > 0 ? `+${comparison.repDelta} rep${comparison.repDelta > 1 ? "s" : ""}` :
               comparison.weightDelta && comparison.weightDelta > 0 ? `+${comparison.weightDelta} kg` :
               comparison.volumeDelta && comparison.volumeDelta > 0 ? `+${comparison.volumeDelta} kg vol` : "improved"}
          </span>
        )}
      </div>

      {(insight || insightBusy) && (
        <div className="wd-insight">
          <span className="wd-insight-tag">✦ AI Insight</span>
          <p>{insight ?? <span className="muted">Analyzing…</span>}</p>
        </div>
      )}
    </div>
  );
}

function dotColor(pct: number): string {
  if (pct >= 85) return "#2f7a4d";
  if (pct >= 60) return "#e0a23b";
  return "#7c6cf0";
}
