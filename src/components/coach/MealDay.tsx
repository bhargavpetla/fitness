"use client";

import { useEffect, useRef, useState } from "react";
import { updatePlanDay, addFoodLog, fetchDailyTotals } from "@/lib/db";
import { fileToDataUrl, uploadPhoto, signedUrl } from "@/lib/photos";
import { Icon } from "@/components/Icon";
import { fx } from "@/lib/fx";
import type { AiPlanDay, MealDayPayload, PlanMeal } from "@/lib/types";

// One day of the meal plan: suggested dishes with photo, portion, macros
// (✓-marked when INDB-verified), expandable recipe, one-tap "Log it" into the
// real tracker, per-meal ticks, an optional photo check-in, and "Complete day".

export function MealDay({
  day,
  locked,
  onUpdated,
  onToast,
}: {
  day: AiPlanDay;
  locked: boolean;
  onUpdated: (d: AiPlanDay) => void;
  onToast: (msg: string) => void;
}) {
  const payload = day.payload as MealDayPayload;
  const checked: boolean[] = payload.meals.map((_, i) => day.actual?.checked?.[i] ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [logged, setLogged] = useState<{ calories: number; protein_g: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Data is shared with manual mode — show what's actually been logged on
  // this date (from either interface) next to the plan's targets.
  useEffect(() => {
    let on = true;
    fetchDailyTotals(day.date, day.date)
      .then((rows) => on && setLogged(rows[0] ?? null))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [day.date, day.actual]);

  useEffect(() => {
    let on = true;
    if (day.photo_url) signedUrl(day.photo_url).then((u) => on && setPhotoUrl(u));
    else setPhotoUrl(null);
    return () => {
      on = false;
    };
  }, [day.photo_url]);

  async function patch(patchObj: Parameters<typeof updatePlanDay>[1]) {
    await updatePlanDay(day.id, patchObj);
    onUpdated({ ...day, ...patchObj } as AiPlanDay);
  }

  async function toggleMeal(i: number) {
    const next = [...checked];
    next[i] = !next[i];
    if (next[i]) fx.pop();
    else fx.tap();
    await patch({ actual: { ...day.actual, checked: next } });
  }

  async function logMeal(i: number, m: PlanMeal) {
    setBusy(`log-${i}`);
    try {
      const log = await addFoodLog({
        date: day.date,
        meal_label: m.slot,
        raw_input: `AI Coach: ${m.name} (${m.portion})`,
        items: [
          {
            name: m.name,
            grams: null,
            calories: m.calories,
            protein_g: m.protein_g,
            carbs_g: m.carbs_g,
            fat_g: m.fat_g,
            assumption: m.portion || null,
          },
        ],
        totals: { calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g },
        vitamins: {},
      });
      if (!log) throw new Error();
      const next = [...checked];
      next[i] = true;
      await patch({
        actual: { ...day.actual, checked: next, food_log_ids: [...(day.actual?.food_log_ids ?? []), log.id] },
      });
      fx.pop();
      onToast("Logged into your day ✓");
    } catch {
      onToast("Could not log that meal.");
    } finally {
      setBusy(null);
    }
  }

  async function completeDay() {
    await patch({ completed: true, completed_at: new Date().toISOString() });
    fx.success();
    onToast(`Day ${day.day_index} complete 🎉`);
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy("photo");
    try {
      const dataUrl = await fileToDataUrl(f);
      const path = await uploadPhoto(dataUrl, "plan");
      if (path) await patch({ photo_url: path });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={locked ? "day-locked-wrap" : undefined}>
      {payload.note && <div className="plan-note">💡 {payload.note}</div>}

      <div className="plan-day-totals">
        <span>{Math.round(payload.totals.calories)} kcal</span>
        <span>P {Math.round(payload.totals.protein_g)}g</span>
        <span>C {Math.round(payload.totals.carbs_g)}g</span>
        <span>F {Math.round(payload.totals.fat_g)}g</span>
      </div>

      {logged && logged.calories > 0 && (
        <div className="sync-chip">
          ⇄ Logged this day: {Math.round(logged.calories)} kcal · P {Math.round(logged.protein_g)}g
        </div>
      )}

      {payload.meals.map((m, i) => (
        <MealCard
          key={i}
          meal={m}
          checked={checked[i]}
          locked={locked}
          busy={busy === `log-${i}`}
          onToggle={() => toggleMeal(i)}
          onLog={() => logMeal(i, m)}
        />
      ))}

      {!locked && (
        <div className="day-actions">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy === "photo"}>
            {busy === "photo" ? (
              <span className="spinner" style={{ borderTopColor: "var(--accent)" }} />
            ) : (
              <><Icon name="camera-outline" size={16} /> {photoUrl ? "Retake day photo" : "Add a day photo"}</>
            )}
          </button>
          {photoUrl && <img className="day-photo" src={photoUrl} alt="Your day" />}
          {!day.completed ? (
            <button className="btn btn-primary" onClick={completeDay}>
              ✓ Complete day {day.day_index}
            </button>
          ) : (
            <div className="day-done-banner pop-in">🎉 Day {day.day_index} done — see you tomorrow</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- one suggested meal ----

function MealCard({
  meal,
  checked,
  locked,
  busy,
  onToggle,
  onLog,
}: {
  meal: PlanMeal;
  checked: boolean;
  locked: boolean;
  busy: boolean;
  onToggle: () => void;
  onLog: () => void;
}) {
  const [showRecipe, setShowRecipe] = useState(false);

  return (
    <div className={`meal-card ${checked ? "checked" : ""}`}>
      <div className="meal-card-top">
        <DishImage imageKey={meal.image_key} src={meal.image_src} />
        <div className="meal-card-text">
          <span className="meal-slot">{meal.slot}</span>
          <div className="meal-card-name">
            {meal.name} {meal.verified && <span className="verified" title="Macros from the Indian Nutrient Databank">✓ measured</span>}
          </div>
          <div className="meal-card-desc">{meal.desc}</div>
          {meal.portion && <div className="meal-card-portion">{meal.portion}</div>}
        </div>
        {!locked && (
          <button className={`meal-check ${checked ? "on" : ""}`} onClick={onToggle} aria-label="Mark eaten">
            ✓
          </button>
        )}
      </div>

      <div className="macros-mini">
        <span>{Math.round(meal.calories)} kcal</span>
        <span><i className="dot" style={{ background: "var(--protein)" }} />{meal.protein_g}g</span>
        <span><i className="dot" style={{ background: "var(--carbs)" }} />{meal.carbs_g}g</span>
        <span><i className="dot" style={{ background: "var(--fat)" }} />{meal.fat_g}g</span>
      </div>

      <div className="meal-card-foot">
        {meal.recipe && meal.recipe.steps.length > 0 && (
          <button className="meal-mini-btn" onClick={() => { fx.tap(); setShowRecipe((v) => !v); }}>
            <Icon name="restaurant-outline" size={13} /> Recipe {meal.recipe.time_min ? `· ${meal.recipe.time_min} min` : ""} {showRecipe ? "▴" : "▾"}
          </button>
        )}
        {!locked && (
          <button className="meal-mini-btn log" onClick={onLog} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: "var(--accent)", width: 12, height: 12 }} /> : "＋ Log it"}
          </button>
        )}
      </div>

      {showRecipe && meal.recipe && (
        <ol className="ex-howto-steps" style={{ marginTop: 10 }}>
          {meal.recipe.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Dish photo, self-hosted after first view: asks the server to cache the
// dataset image into Supabase storage and remembers the result per-session.
function DishImage({ imageKey, src }: { imageKey?: string | null; src?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let on = true;
    setFailed(false);
    if (!imageKey || !src) {
      setUrl(null);
      return;
    }
    const cacheKey = `dishimg:${imageKey}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      setUrl(cached);
      return;
    }
    fetch("/api/plan/meal-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: imageKey, src }),
    })
      .then((r) => r.json())
      .then((j) => {
        const u = j?.url ?? src;
        if (on) {
          setUrl(u);
          try {
            sessionStorage.setItem(cacheKey, u);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => on && setUrl(src));
    return () => {
      on = false;
    };
  }, [imageKey, src]);

  if (!url || failed)
    return (
      <div className="meal-img ph">
        <Icon name="restaurant-outline" size={24} />
      </div>
    );
  return <img className="meal-img" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
