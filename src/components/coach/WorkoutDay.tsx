"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePlanDay, addExerciseLog } from "@/lib/db";
import { thumbUrlFromKey, MEDIA_ATTRIBUTION } from "@/lib/exerciseLibrary";
import { DetailSheet } from "@/components/DetailSheet";
import { fx } from "@/lib/fx";
import type { AiPlanDay, WorkoutDayPayload, PlanExercise, ParsedExercise } from "@/lib/types";

// One day of the training plan: the suggested workout with animations and
// progressive-overload notes. "Log workout" writes a real exercise_log (so
// streaks, PRs and the analysis screen all light up) with whatever the user
// actually did — planned numbers by default, adjustable per exercise.

interface Actual {
  weight: string; // as typed; "" = bodyweight
  reps: number;
  sets: number;
}

export function WorkoutDay({
  day,
  locked,
  onUpdated,
  onToast,
  onReplan,
}: {
  day: AiPlanDay;
  locked: boolean;
  onUpdated: (d: AiPlanDay) => void;
  onToast: (msg: string) => void;
  onReplan?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const payload = day.payload as WorkoutDayPayload;
  // Defensive: a malformed / mismatched payload must not throw during render.
  const planExercises = payload?.exercises ?? [];
  const [actuals, setActuals] = useState<Actual[]>(
    planExercises.map((e) => ({ weight: e.weight_kg == null ? "" : String(e.weight_kg), reps: e.reps, sets: e.sets }))
  );
  const [adjusting, setAdjusting] = useState(false);
  const [howto, setHowto] = useState<PlanExercise | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(patchObj: Parameters<typeof updatePlanDay>[1]) {
    await updatePlanDay(day.id, patchObj);
    onUpdated({ ...day, ...patchObj } as AiPlanDay);
  }

  async function markRest() {
    setBusy(true);
    try {
      const parsed: ParsedExercise = {
        type: "rest",
        exercises: [],
        cardio: null,
        est_calories: null,
        summary: `Rest day — AI plan day ${day.day_index}.`,
      };
      await addExerciseLog({ date: day.date, parsed, raw_input: "AI Coach: rest day" });
      await patch({ completed: true, completed_at: new Date().toISOString() });
      fx.pop();
      onToast("Rest day banked 😌");
    } finally {
      setBusy(false);
    }
  }

  // Life happened — a planned workout becomes rest, and the coach reshuffles
  // the remaining days so the missed muscles aren't dropped from the week.
  async function unexpectedRest() {
    if (!confirm("Turn this into a rest day? The coach will reshuffle your remaining days around it.")) return;
    setBusy(true);
    try {
      const parsed: ParsedExercise = {
        type: "rest",
        exercises: [],
        cardio: null,
        est_calories: null,
        summary: `Unexpected rest — planned ${payload.name} moved along the week.`,
      };
      await addExerciseLog({ date: day.date, parsed, raw_input: "AI Coach: unexpected rest day" });
      await patch({
        completed: true,
        completed_at: new Date().toISOString(),
        actual: { ...day.actual, unexpected_rest: true },
      });
      fx.remove();
      onToast("Rest taken 😌 — reshuffling your week…");
      await onReplan?.();
    } finally {
      setBusy(false);
    }
  }

  async function logWorkout() {
    setBusy(true);
    try {
      const exercises = planExercises.map((e, i) => {
        const a = actuals[i];
        const w = a.weight.trim() === "" ? null : Number(a.weight) || null;
        const set_list = Array.from({ length: a.sets }, () => ({ weight_kg: w, reps: a.reps, each_side: false }));
        const volume = set_list.reduce((s, x) => s + (x.weight_kg ?? 0) * x.reps, 0);
        return {
          name: e.name,
          primary_muscle: e.primary_muscle ?? undefined,
          secondary_muscles: [],
          set_list,
          volume,
          media: e.media ?? null,
        };
      });
      const totalSets = actuals.reduce((s, a) => s + a.sets, 0);
      const parsed: ParsedExercise = {
        type: "strength",
        workout_name: payload.name,
        muscle_groups: payload.focus ?? [],
        exercises,
        cardio: null,
        est_calories: null,
        est_duration_min: Math.round(totalSets * 3.5),
        summary: `AI plan day ${day.day_index}: ${payload.name}.`,
      };
      const log = await addExerciseLog({ date: day.date, parsed, raw_input: `AI Coach day ${day.day_index}` });
      if (!log) throw new Error();
      await patch({
        completed: true,
        completed_at: new Date().toISOString(),
        actual: { ...day.actual, exercise_log_id: log.id },
      });
      fx.success();
      onToast(`Day ${day.day_index} logged 💪`);
      router.push(`/workout/${log.id}`);
    } catch {
      onToast("Could not log the workout.");
      setBusy(false);
    }
  }

  if (payload.kind === "rest") {
    return (
      <div className={`card rest plan-rest ${locked ? "day-locked-wrap" : ""}`} style={{ animation: "none" }}>
        <div style={{ fontSize: 34 }}>😌</div>
        <div className="meal">Rest & recover</div>
        <p className="sub">{payload.note || "Muscle grows on the days you don't lift. Eat well, sleep well."}</p>
        {!locked &&
          (day.completed ? (
            <div className="day-done-banner">✓ Rest day complete</div>
          ) : (
            <button className="btn btn-primary" onClick={markRest} disabled={busy}>
              {busy ? <span className="spinner" /> : "✓ Mark rest day"}
            </button>
          ))}
      </div>
    );
  }

  return (
    <div className={locked ? "day-locked-wrap" : undefined}>
      <div className="plan-wk-head">
        <div className="meal">{payload.name}</div>
        {(payload.focus?.length ?? 0) > 0 && <div className="sub">{payload.focus!.join(" · ")}</div>}
        {payload.note && <div className="plan-note">💡 {payload.note}</div>}
      </div>

      {planExercises.map((e, i) => (
        <div key={i} className="card plan-ex" style={{ animation: "none" }}>
          {/* Whole row is the tap target now — tapping the name (not just the
              thumbnail) opens the how-to animation + steps. */}
          <button
            type="button"
            className="live-ex-head plan-ex-head"
            style={{ padding: 0 }}
            onClick={() => { fx.tap(); setHowto(e); }}
            aria-label={`How to do ${e.name}`}
          >
            <span className="live-ex-thumb">
              {e.media ? <img src={thumbUrlFromKey(e.media)} alt="" loading="lazy" /> : <span className="picker-thumb-ph">✦</span>}
            </span>
            <span className="live-ex-text">
              <span className="live-ex-name">{e.name}</span>
              <span className="live-ex-sub">
                {adjusting
                  ? "adjust below"
                  : `${actuals[i].sets} × ${repTarget(e, actuals[i].reps)}${actuals[i].weight.trim() !== "" ? ` @ ${actuals[i].weight} kg` : ""}`}
                {e.note ? ` · ${e.note}` : ""}
              </span>
            </span>
            <span className="plan-ex-how">How&nbsp;to&nbsp;›</span>
          </button>

          {adjusting && !locked && !day.completed && (
            <div className="plan-adjust">
              <AdjustField label="sets" value={actuals[i].sets} step={1} min={1}
                onChange={(v) => setActuals((a) => a.map((x, j) => (j === i ? { ...x, sets: v } : x)))} />
              <AdjustField label="reps" value={actuals[i].reps} step={1} min={1}
                onChange={(v) => setActuals((a) => a.map((x, j) => (j === i ? { ...x, reps: v } : x)))} />
              <div className="stepper plan-adjust-w">
                <button onClick={() => bumpWeight(i, -2.5)} aria-label="Less weight">−</button>
                <div className="stepper-mid">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="bw"
                    value={actuals[i].weight}
                    onChange={(ev) => setActuals((a) => a.map((x, j) => (j === i ? { ...x, weight: ev.target.value } : x)))}
                  />
                  <span className="stepper-unit">kg</span>
                </div>
                <button onClick={() => bumpWeight(i, 2.5)} aria-label="More weight">+</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!locked && (
        <div className="day-actions">
          {!day.completed ? (
            <>
              <button className="btn btn-ghost" onClick={() => setAdjusting((v) => !v)}>
                {adjusting ? "Done adjusting" : "✎ I did it differently"}
              </button>
              <button className="btn btn-primary" onClick={logWorkout} disabled={busy}>
                {busy ? <span className="spinner" /> : adjusting ? "✓ Log what I did" : "✓ Did it — log workout"}
              </button>
              <button className="live-ex-remove" onClick={unexpectedRest} disabled={busy}>
                😴 Couldn&apos;t make it — take a rest day instead
              </button>
            </>
          ) : (
            <div className="day-done-banner pop-in">
              💪 Day {day.day_index} logged
              {day.actual?.exercise_log_id && (
                <button className="meal-mini-btn" onClick={() => router.push(`/workout/${day.actual!.exercise_log_id}`)}>
                  View analysis ›
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {howto && <PlanHowto exercise={howto} onClose={() => setHowto(null)} />}
    </div>
  );

  function bumpWeight(i: number, d: number) {
    setActuals((a) =>
      a.map((x, j) => {
        if (j !== i) return x;
        const w = x.weight.trim() === "" ? 0 : Number(x.weight) || 0;
        const next = Math.max(0, Math.round((w + d) * 10) / 10);
        return { ...x, weight: next === 0 ? "" : String(next) };
      })
    );
  }
}

// Target rep display: a range ("6–8") when the coach set one, else the single
// rep number. The user still logs one concrete number within the range.
function repTarget(e: PlanExercise, fallbackReps: number): string {
  const lo = e.rep_low;
  const hi = e.rep_high;
  if (lo != null && hi != null && hi > lo) return `${lo}–${hi}`;
  if (lo != null) return String(lo);
  return String(fallbackReps);
}

function AdjustField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - step))} aria-label={`Fewer ${label}`}>−</button>
      <div className="stepper-mid">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value) || min)))}
        />
        <span className="stepper-unit">{label}</span>
      </div>
      <button onClick={() => onChange(value + step)} aria-label={`More ${label}`}>+</button>
    </div>
  );
}

// Animation + rep scheme + how-to steps for a planned exercise, in the shared
// frosted-glass detail popup.
function PlanHowto({ exercise, onClose }: { exercise: PlanExercise; onClose: () => void }) {
  const reps = repTarget(exercise, exercise.reps);
  return (
    <DetailSheet title={<span style={{ textTransform: "capitalize" }}>{exercise.name}</span>} onClose={onClose}>
      <div className="ex-detail-hero glass-hero">
        {exercise.media ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/exercise-media/videos/${exercise.media}.gif`} alt={`${exercise.name} animation`} />
        ) : (
          <span className="ex-detail-hero-ph">✦</span>
        )}
      </div>

      <div className="ex-stat-row">
        <div className="ex-stat">
          <span className="ex-stat-val">{exercise.sets}</span>
          <span className="ex-stat-label">sets</span>
        </div>
        <div className="ex-stat">
          <span className="ex-stat-val">{reps}</span>
          <span className="ex-stat-label">reps</span>
        </div>
        <div className="ex-stat">
          <span className="ex-stat-val">{exercise.weight_kg != null ? exercise.weight_kg : "BW"}</span>
          <span className="ex-stat-label">{exercise.weight_kg != null ? "kg" : "bodyweight"}</span>
        </div>
      </div>

      {exercise.primary_muscle && (
        <div className="ex-detail-tags" style={{ marginBottom: 4 }}>
          <span className="pill on">{exercise.primary_muscle}</span>
        </div>
      )}
      {exercise.note && <div className="plan-note" style={{ marginTop: 10 }}>💡 {exercise.note}</div>}

      {(exercise.steps?.length ?? 0) > 0 ? (
        <>
          <div className="detail-h">How to do it</div>
          <ol className="ex-howto-steps">
            {exercise.steps!.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>No guide for this one — trust your form and go steady.</p>
      )}
      {exercise.media && <p className="media-credit">{MEDIA_ATTRIBUTION}</p>}
    </DetailSheet>
  );
}
