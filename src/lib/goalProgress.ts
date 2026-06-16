import type { Goal } from "@/lib/types";

// Honest, data-driven "days to your goal" estimate.
//
// We don't bluff a date from thin air. Body change comes from *consistency*, so
// progress is measured as the number of days the user actually hit their daily
// targets, and the remaining time is projected from their *recent real* hit-rate
// (last 14 days). If they're consistent it shrinks fast; if they slack it
// stretches; if there isn't enough data yet, we say so instead of inventing a
// number. It recomputes every day from the previous days' logged data.

// A day "counts" if calories land within tolerance of the target. For directional
// goals (cut/bulk) we also require the calories to move the right way.
const CALORIE_TOLERANCE = 0.12; // ±12% of the calorie target
const PROTEIN_MIN_FRACTION = 0.8; // hit at least 80% of the protein target
const RECENT_WINDOW_DAYS = 14;

// How many on-target days add up to a meaningful, visible change. Recomp and
// maintain need the longest runway; a cut shows on the scale sooner.
function milestoneDays(goalType: Goal["goal_type"]): number {
  switch (goalType) {
    case "cut":
      return 56; // ~8 weeks
    case "bulk":
      return 70; // ~10 weeks
    case "recomp":
      return 84; // ~12 weeks — recomp is slow, it's body-fat not weight
    default:
      return 84; // maintain / auto
  }
}

export interface DailyTotal {
  date: string;
  calories: number;
  protein_g: number;
}

export type GoalProgress =
  | { status: "no_goal" }
  | { status: "no_data"; message: string }
  | {
      status: "ok";
      onTargetDays: number;
      milestone: number;
      progressPct: number; // 0..100
      recentHitRate: number; // 0..1 over the last RECENT_WINDOW_DAYS logged window
      daysRemaining: number | null; // null when the pace is ~0 (stalled)
      etaDate: string | null;
      onPace: boolean | null; // vs. the user's optional target date, if set
      message: string;
    };

// Does a single day count as "on target" for this goal?
function isOnTargetDay(day: DailyTotal, goal: Goal): boolean {
  const target = Number(goal.calories);
  if (!target) return false;
  const lo = target * (1 - CALORIE_TOLERANCE);
  const hi = target * (1 + CALORIE_TOLERANCE);
  const proteinOk = day.protein_g >= Number(goal.protein_g) * PROTEIN_MIN_FRACTION;

  switch (goal.goal_type) {
    case "cut":
      // Don't blow past the target; protein protects muscle in a deficit.
      return day.calories > 0 && day.calories <= hi && proteinOk;
    case "bulk":
      // Need to actually eat enough to grow.
      return day.calories >= lo && proteinOk;
    default:
      // recomp / maintain / auto — stay in the band and hit protein.
      return day.calories >= lo && day.calories <= hi && proteinOk;
  }
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00").getTime();
  const b = new Date(toIso + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

export function computeGoalProgress(args: {
  goal: Goal | null;
  endGoal: string | null;
  endGoalSetAt: string | null;
  endGoalTargetDate: string | null;
  dailyTotals: DailyTotal[]; // any days with food logged, ascending by date
  today: string;
}): GoalProgress {
  const { goal, endGoal, endGoalSetAt, endGoalTargetDate, dailyTotals, today } = args;

  if (!endGoal || !goal) return { status: "no_goal" };

  // Only count days from when the goal was set forward.
  const since = endGoalSetAt ?? today;
  const relevant = dailyTotals
    .filter((d) => d.date >= since && d.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (relevant.length < 3) {
    return {
      status: "no_data",
      message:
        "Log a few days of meals and your goal countdown will appear here — it's based on how consistently you hit your targets.",
    };
  }

  const onTargetDays = relevant.filter((d) => isOnTargetDay(d, goal)).length;
  const milestone = milestoneDays(goal.goal_type);

  // Recent real hit-rate over the trailing window of *logged* days.
  const recentWindow = relevant.slice(-RECENT_WINDOW_DAYS);
  const recentHits = recentWindow.filter((d) => isOnTargetDay(d, goal)).length;
  const recentHitRate = recentWindow.length ? recentHits / recentWindow.length : 0;

  const remainingTargetDays = Math.max(0, milestone - onTargetDays);
  const progressPct = Math.min(100, Math.round((onTargetDays / milestone) * 100));

  // Project calendar days remaining: at the recent hit-rate, each calendar day
  // contributes `recentHitRate` of an on-target day. Stalled (rate ~0) -> null.
  let daysRemaining: number | null = null;
  let etaDate: string | null = null;
  if (remainingTargetDays === 0) {
    daysRemaining = 0;
    etaDate = today;
  } else if (recentHitRate > 0.05) {
    daysRemaining = Math.ceil(remainingTargetDays / recentHitRate);
    etaDate = addDaysIso(today, daysRemaining);
  }

  // Compare to the user's optional target date.
  let onPace: boolean | null = null;
  if (endGoalTargetDate && daysRemaining != null) {
    const daysToDeadline = daysBetween(today, endGoalTargetDate);
    onPace = daysToDeadline >= daysRemaining;
  }

  const message = buildMessage({
    goalType: goal.goal_type,
    remainingTargetDays,
    daysRemaining,
    recentHitRate,
    onPace,
  });

  return {
    status: "ok",
    onTargetDays,
    milestone,
    progressPct,
    recentHitRate,
    daysRemaining,
    etaDate,
    onPace,
    message,
  };
}

function buildMessage(args: {
  goalType: Goal["goal_type"];
  remainingTargetDays: number;
  daysRemaining: number | null;
  recentHitRate: number;
  onPace: boolean | null;
}): string {
  const { remainingTargetDays, daysRemaining, recentHitRate, onPace } = args;

  if (remainingTargetDays === 0) {
    return "You've hit the consistency milestone for your goal. Keep it rolling. 🎉";
  }
  if (daysRemaining == null) {
    return "Your pace has stalled — get a few on-target days in this week and the countdown restarts.";
  }
  const pct = Math.round(recentHitRate * 100);
  const pace =
    recentHitRate >= 0.8
      ? "You're dialed in"
      : recentHitRate >= 0.5
        ? "Solid pace"
        : "Tighten it up";
  const deadline =
    onPace == null
      ? ""
      : onPace
        ? " — ahead of your target date."
        : " — a bit behind your target date; hit more days to catch up.";
  return `${pace}: hitting targets ${pct}% of recent days${deadline}`;
}
