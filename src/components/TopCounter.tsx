"use client";

import { AnimatedNumber } from "./AnimatedNumber";
import { MacroRing } from "./MacroRing";
import type { Goal } from "@/lib/types";

// Food mode: macros consumed vs goal. Exercise mode: sessions this week vs target.
export function TopCounter({
  mode,
  goal,
  consumed,
  sessions,
  sessionTarget,
}: {
  mode: "food" | "exercise";
  goal: Goal | null;
  consumed: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  sessions: number;
  sessionTarget: number;
}) {
  if (mode === "exercise") {
    return (
      <div className="counter">
        <div className="cal-label">Sessions this week</div>
        <div className="cal-row">
          <AnimatedNumber className="cal-big" value={sessions} />
          <span className="cal-goal">/ {sessionTarget}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          No targets here — just keep the rhythm.
        </p>
      </div>
    );
  }

  const cal = goal?.calories ?? 0;
  return (
    <div className="counter">
      <div className="cal-label">Calories</div>
      <div className="cal-row">
        <AnimatedNumber className="cal-big" value={Math.round(consumed.calories)} />
        <span className="cal-goal">/ {Math.round(cal).toLocaleString()}</span>
      </div>
      <div className="macro-row">
        <MacroRing label="Protein" value={consumed.protein_g} goal={goal?.protein_g ?? 0} color="var(--protein)" />
        <MacroRing label="Carbs" value={consumed.carbs_g} goal={goal?.carbs_g ?? 0} color="var(--carbs)" />
        <MacroRing label="Fat" value={consumed.fat_g} goal={goal?.fat_g ?? 0} color="var(--fat)" />
      </div>
    </div>
  );
}
