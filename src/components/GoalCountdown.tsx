"use client";

import { useEffect, useState } from "react";
import { fetchDailyTotals } from "@/lib/db";
import { computeGoalProgress, type GoalProgress } from "@/lib/goalProgress";
import { todayStr, addDays } from "@/lib/date";
import type { Goal, Profile } from "@/lib/types";

// Home-screen "days to your goal" card. Only renders when the user has set an
// optional end goal in Settings. The estimate is honest: it counts the days the
// user actually hit their targets and projects from their recent real hit-rate,
// recomputed each day from logged data. No bluffed numbers.
export function GoalCountdown({ profile, goal }: { profile: Profile | null; goal: Goal | null }) {
  const [progress, setProgress] = useState<GoalProgress | null>(null);

  useEffect(() => {
    if (!profile?.end_goal || !goal) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const today = todayStr();
      const since = profile.end_goal_set_at ?? today;
      // Look back from the goal's day 0 (or 30 days, whichever is longer) to today.
      const from = since < addDays(today, -30) ? since : addDays(today, -30);
      const totals = await fetchDailyTotals(from, today);
      if (cancelled) return;
      setProgress(
        computeGoalProgress({
          goal,
          endGoal: profile.end_goal,
          endGoalSetAt: profile.end_goal_set_at,
          endGoalTargetDate: profile.end_goal_target_date,
          dailyTotals: totals,
          today,
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, goal]);

  if (!progress || progress.status === "no_goal") return null;

  if (progress.status === "no_data") {
    return (
      <div className="goal-countdown muted-card">
        <div className="gc-goal">🎯 {profile?.end_goal}</div>
        <p className="gc-sub">{progress.message}</p>
      </div>
    );
  }

  const headline =
    progress.daysRemaining == null
      ? "Pace stalled"
      : progress.daysRemaining === 0
        ? "Milestone reached 🎉"
        : `~${progress.daysRemaining} days to go`;

  return (
    <div className="goal-countdown">
      <div className="gc-top">
        <div className="gc-goal" title={profile?.end_goal ?? ""}>🎯 {profile?.end_goal}</div>
        <div className="gc-days">{headline}</div>
      </div>
      <div className="gc-bar" aria-hidden>
        <div className="gc-bar-fill" style={{ width: `${progress.progressPct}%` }} />
      </div>
      <div className="gc-meta">
        <span>{progress.onTargetDays}/{progress.milestone} on-target days</span>
        {progress.etaDate && (
          <span>
            ETA {new Date(progress.etaDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      <p className="gc-sub">{progress.message}</p>
    </div>
  );
}
