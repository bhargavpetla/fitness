import { todayStr } from "@/lib/date";
import { liveStreak } from "@/lib/streak";
import type { Profile, Goal, FoodLog, ExerciseConfig, Streak } from "@/lib/types";

// Picks at most ONE gentle nudge for today, and only shows it once per day
// (tracked in localStorage). Over-nudging kills the calm feel.
export function buildNudge(args: {
  profile: Profile | null;
  goal: Goal | null;
  foods: FoodLog[];
  weekSessions: number;
  cfg: ExerciseConfig | null;
  streak: Streak | null;
}): string | null {
  if (typeof window === "undefined") return null;
  const today = todayStr();
  const key = `nudge-shown-${today}`;
  if (localStorage.getItem(key)) return null;

  const { profile, goal, foods, weekSessions, cfg, streak } = args;
  const streakN = liveStreak(streak);
  const hour = new Date().getHours();
  const fn = profile?.first_name?.trim();
  const hey = fn ? `${fn}, ` : "";

  let msg: string | null = null;

  // Streak risk takes priority — don't lose momentum.
  if (streakN > 0 && foods.length === 0 && hour >= 18) {
    msg = `${hey ? fn + "—your" : "Your"} ${streakN}-day streak is alive. Log anything to keep it going.`;
  } else if (foods.length === 0 && hour >= 19) {
    msg = `${hey}haven't logged today's food yet.`;
  } else if (cfg && weekSessions < cfg.weekly_target_sessions && hour >= 9 && hour < 18) {
    msg = `${weekSessions} of ${cfg.weekly_target_sessions} sessions this week.${
      cfg.split_pattern ? ` Today looks like a ${nextSplit(cfg.split_pattern, weekSessions)} day.` : ""
    }`;
  } else if (goal && hour < 11 && foods.length === 0) {
    msg = `${hey ? "Fresh start, " + fn + "." : "Fresh start."} Today's target: ${Math.round(
      goal.protein_g
    )}g protein, ${Math.round(goal.calories).toLocaleString()} cal.`;
  }

  if (msg) localStorage.setItem(key, "1");
  return msg;
}

// Very light split inference for the nudge text — purely informational, never enforced.
function nextSplit(pattern: string, doneThisWeek: number): string {
  const parts = pattern
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return "training";
  return parts[doneThisWeek % parts.length];
}
