"use client";

import { useEffect, useRef, useState } from "react";
import type { FoodParseResult, ParsedExercise } from "@/lib/types";
import { fileToDataUrl } from "@/lib/photos";
import { fetchRecentFoodInputs, type RecentFoodInput } from "@/lib/db";

type Mode = "food" | "exercise";

// Slide-up input sheet. For food it runs the Gemini parse, shows a confirm card with
// editable per-item grams, then commits. For exercise it parses and previews.
export function AddSheet({
  mode,
  onClose,
  onSaveFood,
  onSaveExercise,
}: {
  mode: Mode;
  onClose: () => void;
  onSaveFood: (args: {
    meal_label: string;
    raw_input: string;
    result: FoodParseResult;
    photoDataUrl: string | null;
  }) => Promise<void>;
  onSaveExercise: (args: { raw_input: string; parsed: ParsedExercise }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [meal, setMeal] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [food, setFood] = useState<FoodParseResult | null>(null);
  const [exercise, setExercise] = useState<ParsedExercise | null>(null);
  const [recent, setRecent] = useState<RecentFoodInput[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load recent meals for the quick "log it again" chips (food mode only).
  useEffect(() => {
    if (mode !== "food") return;
    fetchRecentFoodInputs(6).then(setRecent).catch(() => {});
  }, [mode]);

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setPhoto(await fileToDataUrl(f));
    } catch {
      setError("Could not read that photo.");
    }
  }

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "food") {
        const res = await fetch("/api/food/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ raw_input: text, photo }),
        });
        const json = await readJsonSafe(res);
        if (!res.ok) throw new Error(json?.error ?? "Could not analyze. Try rephrasing.");
        setFood(json as unknown as FoodParseResult);
      } else {
        const res = await fetch("/api/exercise/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ raw_input: text }),
        });
        const json = await readJsonSafe(res);
        if (!res.ok) throw new Error(json?.error ?? "Could not parse. Try rephrasing.");
        setExercise(json as unknown as ParsedExercise);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Inline gram edit rescales that item's macros proportionally and re-totals.
  function editGrams(idx: number, grams: number) {
    if (!food) return;
    const item = food.items[idx];
    if (!item.grams || item.grams <= 0) return;
    const k = grams / item.grams;
    const next = { ...item, grams, calories: r(item.calories * k), protein_g: r(item.protein_g * k), carbs_g: r(item.carbs_g * k), fat_g: r(item.fat_g * k) };
    const items = food.items.map((it, i) => (i === idx ? next : it));
    setFood({ ...food, items, totals: sumTotals(items) });
  }

  async function commit() {
    setBusy(true);
    try {
      if (mode === "food" && food) {
        await onSaveFood({ meal_label: meal || guessMeal(), raw_input: text, result: food, photoDataUrl: photo });
      } else if (mode === "exercise" && exercise) {
        await onSaveExercise({ raw_input: text, parsed: exercise });
      }
      onClose();
    } catch {
      setError("Could not save. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        {!food && !exercise ? (
          <>
            <h3>{mode === "food" ? "What did you eat?" : "Log a workout"}</h3>
            {mode === "food" && (
              <div className="pill-group" style={{ marginBottom: 12 }}>
                {["breakfast", "lunch", "snack", "dinner"].map((m) => (
                  <button key={m} className={`pill ${meal === m ? "on" : ""}`} onClick={() => setMeal(m)}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="field"
              rows={3}
              placeholder={
                mode === "food"
                  ? "cashew 20g, oats 40g, milk 200ml, 2 eggs"
                  : "3 sets bench 60kg x 8, 3 sets incline db 22kg x 10 — or 'rest day'"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            {mode === "food" && !text.trim() && recent.length > 0 && (
              <div className="recent-foods">
                <div className="recent-foods-label">Log again</div>
                {recent.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="recent-chip"
                    title={r.raw_input}
                    onClick={() => {
                      setText(r.raw_input);
                      if (r.meal_label) setMeal(r.meal_label);
                    }}
                  >
                    {shorten(r.raw_input)}
                    <span className="recent-chip-when">{relativeDay(r.date)}</span>
                  </button>
                ))}
              </div>
            )}
            {mode === "food" && (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => fileRef.current?.click()}>
                  {photo ? "✓ Photo attached" : "📷 Add a photo (optional)"}
                </button>
              </>
            )}
            {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
            <div className="row">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || (!text.trim() && !photo)} onClick={analyze}>
                {busy ? <span className="spinner" /> : "Analyze"}
              </button>
            </div>
          </>
        ) : mode === "food" && food ? (
          <>
            <h3>Confirm</h3>
            {food.items.map((it, i) => (
              <div key={i} className="card" style={{ animation: "none" }}>
                <div className="card-top">
                  <div>
                    <div className="meal">{it.name}</div>
                    {it.assumption && <div className="sub">{it.assumption}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {it.grams != null && (
                      <input
                        type="number"
                        value={it.grams}
                        onChange={(e) => editGrams(i, Number(e.target.value))}
                        style={{ width: 64, padding: 6, border: "1px solid var(--line)", borderRadius: 8, fontSize: 14 }}
                      />
                    )}
                    <span className="muted" style={{ fontSize: 13 }}>{it.grams != null ? "g" : ""}</span>
                  </div>
                </div>
                <div className="macros-mini">
                  <span>{Math.round(it.calories)} kcal</span>
                  <span><i className="dot" style={{ background: "var(--protein)" }} />{it.protein_g}g</span>
                  <span><i className="dot" style={{ background: "var(--carbs)" }} />{it.carbs_g}g</span>
                  <span><i className="dot" style={{ background: "var(--fat)" }} />{it.fat_g}g</span>
                </div>
              </div>
            ))}
            <div className="card" style={{ animation: "none", background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
              <div className="card-top">
                <div className="meal">Total</div>
                <div className="kcal">{Math.round(food.totals.calories)} kcal</div>
              </div>
              <div className="macros-mini">
                <span>P {food.totals.protein_g}g</span>
                <span>C {food.totals.carbs_g}g</span>
                <span>F {food.totals.fat_g}g</span>
              </div>
            </div>
            {food.notes?.map((n, i) => (
              <p key={i} className="muted" style={{ fontSize: 13, margin: "4px 0" }}>• {n}</p>
            ))}
            {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setFood(null)}>Back</button>
              <button className="btn btn-primary" disabled={busy} onClick={commit}>
                {busy ? <span className="spinner" /> : "Save"}
              </button>
            </div>
          </>
        ) : exercise ? (
          <>
            <h3>Confirm workout</h3>
            <div className="card" style={{ animation: "none" }}>
              <div className="meal">{exercise.workout_name || (exercise.type === "strength" ? "Strength" : exercise.type)}</div>
              {(exercise.muscle_groups?.length ?? 0) > 0 && <p className="sub">{exercise.muscle_groups!.join(" · ")}</p>}
              {exercise.exercises.map((e, i) => {
                const sets = e.set_list ?? [];
                const reps = sets.map((s) => s.reps).join("/");
                const w = sets.find((s) => s.weight_kg != null);
                return (
                  <div key={i} className="macros-mini" style={{ justifyContent: "space-between" }}>
                    <span style={{ color: "var(--ink)" }}>{e.name}</span>
                    <span>{sets.length}×[{reps || "—"}]{w?.weight_kg != null ? ` @ ${w.weight_kg}kg${w.each_side ? " ea" : ""}` : ""}</span>
                  </div>
                );
              })}
              {exercise.cardio && (
                <div className="macros-mini">
                  <span>{exercise.cardio.activity}</span>
                  {exercise.cardio.duration_min != null && <span>{exercise.cardio.duration_min} min</span>}
                  {exercise.cardio.distance_km != null && <span>{exercise.cardio.distance_km} km</span>}
                </div>
              )}
              {exercise.est_calories != null && <p className="muted" style={{ fontSize: 13 }}>~{exercise.est_calories} kcal</p>}
            </div>
            {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setExercise(null)}>Back</button>
              <button className="btn btn-primary" disabled={busy} onClick={commit}>
                {busy ? <span className="spinner" /> : "Save"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

// Reads a response body as JSON without throwing on non-JSON (e.g. a gateway
// timeout HTML page). Returns null on parse failure so callers can fall back to
// a friendly message instead of the cryptic native "string did not match the
// expected pattern" error from a failed JSON.parse.
async function readJsonSafe(res: Response): Promise<{ error?: string } & Record<string, unknown> | null> {
  const body = await res.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// First-line, length-capped preview of a logged meal for the chip label.
function shorten(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 38 ? oneLine.slice(0, 36) + "…" : oneLine;
}

// "Yesterday" / "2d ago" / a short date — keeps chips compact.
function relativeDay(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function r(n: number) {
  return Math.round(n * 10) / 10;
}
function sumTotals(items: FoodParseResult["items"]) {
  return items.reduce(
    (a, i) => ({
      calories: r(a.calories + i.calories),
      protein_g: r(a.protein_g + i.protein_g),
      carbs_g: r(a.carbs_g + i.carbs_g),
      fat_g: r(a.fat_g + i.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}
function guessMeal(): string {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 18) return "snack";
  return "dinner";
}
