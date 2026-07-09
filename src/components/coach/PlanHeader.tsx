"use client";

import { useState } from "react";
import { adherencePct, completedCount, planStreak, MILESTONES } from "@/lib/planProgress";
import { prettyDate } from "@/lib/date";
import type { AiPlan, AiPlanDay } from "@/lib/types";

// Plan progress + gamification: day counter, adherence, streak, milestone
// medals, and the 30-dot month map. Management actions live behind ⋯.

export function PlanHeader({
  plan,
  days,
  onStop,
  onDelete,
  onRegenerate,
  onAdjust,
}: {
  plan: AiPlan;
  days: AiPlanDay[];
  onStop: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onAdjust: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const done = completedCount(days);
  const adherence = adherencePct(days);
  const streak = planStreak(days);
  const pct = days.length ? Math.round((done / days.length) * 100) : 0;

  return (
    <div className="plan-head card" style={{ animation: "none" }}>
      <div className="card-top">
        <div>
          <div className="meal">{plan.kind === "meal" ? "This week's meals" : "This week's training"}</div>
          <div className="sub">{prettyDate(plan.start_date)} → {prettyDate(plan.end_date)}</div>
        </div>
        <div style={{ position: "relative", flex: "0 0 auto" }}>
          <button className="icon-btn" aria-label="Plan options" onClick={() => setMenu((v) => !v)}>⋯</button>
          {menu && (
            <>
              <div className="plan-menu-backdrop" onClick={() => setMenu(false)} />
              <div className="plan-menu">
                <button onClick={() => { setMenu(false); onAdjust(); }}>Adjust remaining days</button>
                <button onClick={() => { setMenu(false); onRegenerate(); }}>New week (replaces this one)</button>
                <button onClick={() => { setMenu(false); onStop(); }}>Stop plan</button>
                <button className="danger" onClick={() => { setMenu(false); onDelete(); }}>Delete plan</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="gc-bar plan-bar"><div className="gc-bar-fill" style={{ width: `${pct}%` }} /></div>

      <div className="plan-stats">
        <span><b>{done}</b>/{days.length} days</span>
        {adherence != null && <span><b>{adherence}%</b> adherence</span>}
        <span className={streak > 0 ? "plan-streak on" : "plan-streak"}>🔥 <b>{streak}</b></span>
      </div>

      <div className="badge-row">
        {MILESTONES.map((m) => (
          <span key={m.at} className={`badge ${done >= m.at ? "lit" : ""}`} title={`${m.label}: ${m.at} days completed`}>
            {m.emoji}
            <i>{m.at}</i>
          </span>
        ))}
      </div>
    </div>
  );
}
