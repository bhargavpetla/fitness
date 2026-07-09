"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExercisePicker } from "./ExercisePicker";
import { LoadingJoke } from "@/components/LoadingJoke";
import { Toast } from "@/components/Toast";
import { useLiquidGlass } from "@/lib/liquidGlass";
import { thumbUrlFromKey, MEDIA_ATTRIBUTION, type LibraryExercise } from "@/lib/exerciseLibrary";
import {
  loadSession,
  saveSession,
  clearSession,
  newSession,
  entryFromLibrary,
  sessionDurationMin,
  fmtElapsed,
  type LiveSession,
  type LiveEntry,
} from "@/lib/liveSession";
import { addExerciseLog } from "@/lib/db";
import { todayStr } from "@/lib/date";
import { setVolume } from "@/lib/workout";
import type { ExerciseSet, ParsedExercise } from "@/lib/types";

// The live logging screen: start, pick exercises, log sets between actual sets
// at the gym, finish → AI names/annotates the workout → lands on the detail
// analysis. Session state hits localStorage on every change, so a locked phone
// or dead battery costs nothing.

export function LiveWorkout() {
  const router = useRouter();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [howto, setHowto] = useState<LiveEntry | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const headRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useLiquidGlass(headRef, { scale: -70, blur: 4, fallbackBlur: 14 });
  useLiquidGlass(barRef, { scale: -70, blur: 4, fallbackBlur: 14 });

  // Resume an in-progress session or start fresh.
  useEffect(() => {
    const s = loadSession() ?? newSession();
    setSession(s);
    saveSession(s);
    setExpandedKey(s.entries[s.entries.length - 1]?.key ?? null);
  }, []);

  // 1s tick drives the elapsed + rest timers.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const update = useCallback((mut: (s: LiveSession) => LiveSession) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = mut(prev);
      saveSession(next);
      return next;
    });
  }, []);

  const totalSets = useMemo(
    () => (session ? session.entries.reduce((a, e) => a + e.sets.length, 0) : 0),
    [session]
  );

  function addExercise(e: LibraryExercise) {
    const entry = entryFromLibrary(e);
    update((s) => ({ ...s, entries: [...s.entries, entry] }));
    setExpandedKey(entry.key);
    setPickerOpen(false);
  }

  function logSet(key: string, set: ExerciseSet) {
    update((s) => ({
      ...s,
      lastSetAt: Date.now(),
      entries: s.entries.map((e) => (e.key === key ? { ...e, sets: [...e.sets, set] } : e)),
    }));
  }

  function removeSet(key: string, idx: number) {
    update((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.key === key ? { ...e, sets: e.sets.filter((_, i) => i !== idx) } : e)),
    }));
  }

  function removeEntry(key: string) {
    if (!confirm("Remove this exercise and its sets?")) return;
    update((s) => ({ ...s, entries: s.entries.filter((e) => e.key !== key) }));
  }

  function leave() {
    // An untouched session evaporates; one with logged sets is kept so the
    // home screen offers "Resume workout".
    if (session && session.entries.length === 0) clearSession();
    router.push("/");
  }

  async function finish() {
    if (!session) return;
    setSaving(true);
    try {
      const res = await fetch("/api/exercise/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          duration_min: sessionDurationMin(session),
          entries: session.entries.map((e) => ({
            name: e.name,
            body_part: e.bodyPart,
            equipment: e.equipment,
            target: e.target,
            secondary: e.secondary,
            media: e.media,
            sets: e.sets,
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(json?.error ?? "Could not process the workout.");
      const parsed = json as ParsedExercise;
      const raw = session.entries
        .map((e) => `${e.name}: ${e.sets.map((s) => `${s.weight_kg ?? "bw"}${s.each_side ? "ea" : ""}x${s.reps}`).join(", ")}`)
        .join(" | ");
      const log = await addExerciseLog({ date: todayStr(), parsed, raw_input: `Live: ${raw}` });
      if (!log) throw new Error("Could not save the workout.");
      clearSession();
      router.replace(`/workout/${log.id}`);
    } catch (e) {
      setSaving(false);
      setFinishOpen(false);
      setToast((e as Error).message || "Could not save — your session is untouched.");
    }
  }

  if (!session) {
    return (
      <div className="app-shell">
        <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
      </div>
    );
  }

  if (saving) {
    return (
      <div className="app-shell">
        <LoadingJoke label="Coach is writing up your workout…" />
      </div>
    );
  }

  const resting = session.lastSetAt != null && now - session.lastSetAt < 15 * 60 * 1000;

  return (
    <div className="app-shell live">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="live-head glass" ref={headRef}>
        <button className="icon-btn" onClick={leave} aria-label="Back">‹</button>
        <div className="live-head-mid">
          <span className="live-title">Live workout</span>
          <span className="live-meta">
            ⏱ {fmtElapsed(session.startedAt, now)}
            {totalSets > 0 && <> · {totalSets} set{totalSets > 1 ? "s" : ""}</>}
            {resting && <span className="live-rest"> · rest {fmtElapsed(session.lastSetAt!, now)}</span>}
          </span>
        </div>
        <button
          className="live-finish"
          disabled={totalSets === 0}
          onClick={() => setFinishOpen(true)}
        >
          Finish
        </button>
      </div>

      <div className="content live-body">
        {session.entries.length === 0 ? (
          <div className="center-screen" style={{ padding: "60px 20px" }}>
            <div style={{ fontSize: 40 }}>🏋️</div>
            <p className="muted" style={{ maxWidth: 260 }}>
              Pick your first exercise. Log each set right after you rack the weight — the AI writes it all up when you're done.
            </p>
          </div>
        ) : (
          session.entries.map((e, i) => (
            <LiveExerciseCard
              key={e.key}
              index={i + 1}
              entry={e}
              expanded={expandedKey === e.key}
              onToggle={() => setExpandedKey(expandedKey === e.key ? null : e.key)}
              onLogSet={(s) => logSet(e.key, s)}
              onRemoveSet={(idx) => removeSet(e.key, idx)}
              onRemove={() => removeEntry(e.key)}
              onHowto={() => setHowto(e)}
            />
          ))
        )}
      </div>

      <div className="live-bar glass" ref={barRef}>
        <button className="btn-add" onClick={() => setPickerOpen(true)}>+ Add exercise</button>
      </div>

      {pickerOpen && <ExercisePicker onClose={() => setPickerOpen(false)} onPick={addExercise} />}
      {howto && <HowtoSheet entry={howto} onClose={() => setHowto(null)} />}

      {finishOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setFinishOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true">
            <h3>Done for today?</h3>
            <div className="finish-stats">
              <div className="finish-stat">
                <span className="finish-stat-val">{session.entries.filter((e) => e.sets.length > 0).length}</span>
                <span className="finish-stat-label">exercises</span>
              </div>
              <div className="finish-stat">
                <span className="finish-stat-val">{totalSets}</span>
                <span className="finish-stat-label">sets</span>
              </div>
              <div className="finish-stat">
                <span className="finish-stat-val">
                  {session.entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + setVolume(s), 0), 0).toLocaleString()}
                </span>
                <span className="finish-stat-label">kg volume</span>
              </div>
              <div className="finish-stat">
                <span className="finish-stat-val">{sessionDurationMin(session)}</span>
                <span className="finish-stat-label">minutes</span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              The AI will name the session, map the muscles, and estimate the burn.
            </p>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setFinishOpen(false)}>Keep logging</button>
              <button className="btn btn-primary" onClick={finish}>Save workout</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- one exercise in the session ----

const SIDE_EQUIPMENT = /dumbbell|kettlebell/i;

function LiveExerciseCard({
  index,
  entry,
  expanded,
  onToggle,
  onLogSet,
  onRemoveSet,
  onRemove,
  onHowto,
}: {
  index: number;
  entry: LiveEntry;
  expanded: boolean;
  onToggle: () => void;
  onLogSet: (s: ExerciseSet) => void;
  onRemoveSet: (idx: number) => void;
  onRemove: () => void;
  onHowto: () => void;
}) {
  const last = entry.sets[entry.sets.length - 1];
  const [weight, setWeight] = useState<string>(last?.weight_kg != null ? String(last.weight_kg) : "");
  const [reps, setReps] = useState<number>(last?.reps ?? 10);
  const [eachSide, setEachSide] = useState<boolean>(last?.each_side ?? SIDE_EQUIPMENT.test(entry.equipment));

  function log() {
    const w = weight.trim() === "" ? null : Number(weight);
    if (w != null && (!Number.isFinite(w) || w < 0)) return;
    if (!reps || reps < 1) return;
    onLogSet({ weight_kg: w, reps, each_side: w != null && eachSide });
  }

  function bumpWeight(d: number) {
    const w = weight.trim() === "" ? 0 : Number(weight) || 0;
    const next = Math.max(0, Math.round((w + d) * 10) / 10);
    setWeight(next === 0 ? "" : String(next));
  }

  return (
    <div className={`live-ex ${expanded ? "open" : ""}`}>
      <button className="live-ex-head" onClick={onToggle}>
        <span className="live-ex-thumb" onClick={(ev) => { ev.stopPropagation(); onHowto(); }}>
          {entry.media ? <img src={thumbUrlFromKey(entry.media)} alt="" /> : <span className="picker-thumb-ph">✦</span>}
        </span>
        <span className="live-ex-text">
          <span className="live-ex-name"><span className="wd-ex-num">{index}</span> {entry.name}</span>
          <span className="live-ex-sub">
            {entry.sets.length === 0
              ? `${entry.target || entry.bodyPart} · no sets yet`
              : `${entry.sets.length} set${entry.sets.length > 1 ? "s" : ""} · ${entry.sets
                  .map((s) => `${s.weight_kg ?? "bw"}×${s.reps}`)
                  .join("  ")}`}
          </span>
        </span>
        <span className="ex-row-go">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="live-ex-body">
          {entry.sets.map((s, i) => (
            <div key={i} className="wd-set-row live-set-row">
              <span className="wd-set-label">Set {i + 1}</span>
              <span className="wd-set-weight">{s.weight_kg == null ? "Bodyweight" : `${s.weight_kg} kg${s.each_side ? " each" : ""}`}</span>
              <span className="wd-set-reps">{s.reps} reps</span>
              <button className="live-set-x" onClick={() => onRemoveSet(i)} aria-label={`Remove set ${i + 1}`}>×</button>
            </div>
          ))}

          <div className="set-logger">
            <div className="set-logger-fields">
              <div className="stepper">
                <button onClick={() => bumpWeight(-2.5)} aria-label="Less weight">−</button>
                <div className="stepper-mid">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="bw"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                  <span className="stepper-unit">kg</span>
                </div>
                <button onClick={() => bumpWeight(2.5)} aria-label="More weight">+</button>
              </div>
              <span className="set-logger-x">×</span>
              <div className="stepper">
                <button onClick={() => setReps((r) => Math.max(1, r - 1))} aria-label="Fewer reps">−</button>
                <div className="stepper-mid">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={reps}
                    onChange={(e) => setReps(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  />
                  <span className="stepper-unit">reps</span>
                </div>
                <button onClick={() => setReps((r) => r + 1)} aria-label="More reps">+</button>
              </div>
            </div>
            {weight.trim() !== "" && SIDE_EQUIPMENT.test(entry.equipment) && (
              <label className="side-toggle">
                <input type="checkbox" checked={eachSide} onChange={(e) => setEachSide(e.target.checked)} />
                per side (each dumbbell)
              </label>
            )}
            <button className="btn btn-primary set-log-btn" onClick={log} disabled={!reps || reps < 1}>
              ✓ Log set {entry.sets.length + 1}
            </button>
          </div>

          <button className="live-ex-remove" onClick={onRemove}>Remove exercise</button>
        </div>
      )}
    </div>
  );
}

// ---- how-to reference sheet (animation + steps), available mid-workout ----

function HowtoSheet({ entry, onClose }: { entry: LiveEntry; onClose: () => void }) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="ex-detail-hero">
          {entry.media ? (
            <img src={`/exercise-media/videos/${entry.media}.gif`} alt={`${entry.name} animation`} />
          ) : (
            <span className="ex-detail-hero-ph">✦</span>
          )}
        </div>
        <h3 style={{ textTransform: "capitalize" }}>{entry.name}</h3>
        <div className="ex-detail-tags" style={{ marginBottom: 8 }}>
          <span className="pill on">{entry.target || entry.bodyPart}</span>
          {entry.secondary.slice(0, 3).map((m) => (
            <span key={m} className="pill">{m}</span>
          ))}
        </div>
        {entry.steps.length > 0 ? (
          <ol className="ex-howto-steps">
            {entry.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>No instructions for this one — it's your custom move. You know what to do. 💪</p>
        )}
        {entry.media && <p className="media-credit">{MEDIA_ATTRIBUTION}</p>}
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
