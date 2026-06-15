import { todayStr, addDays } from "@/lib/date";
import type { Streak } from "@/lib/types";

// Recomputes streak state when a log happens on `logDate`. Streak = consecutive
// days with any log (food or exercise); a rest day counts as engagement.
export function bumpStreak(streak: Streak | null, logDate: string): Streak {
  const base: Streak = streak ?? {
    user_id: "",
    current_streak: 0,
    longest_streak: 0,
    last_log_date: null,
    total_days_logged: 0,
  };

  // Same day already counted — no change.
  if (base.last_log_date === logDate) return base;

  let current: number;
  if (base.last_log_date && addDays(base.last_log_date, 1) === logDate) {
    current = base.current_streak + 1; // consecutive
  } else if (base.last_log_date && base.last_log_date > logDate) {
    // Backfilling an older day — don't disturb the live streak.
    return { ...base, total_days_logged: base.total_days_logged + 1 };
  } else {
    current = 1; // gap, or first ever
  }

  return {
    ...base,
    current_streak: current,
    longest_streak: Math.max(base.longest_streak, current),
    last_log_date: logDate,
    total_days_logged: base.total_days_logged + 1,
  };
}

// If the user missed yesterday, the live streak is stale until they log again.
export function liveStreak(streak: Streak | null): number {
  if (!streak?.last_log_date) return 0;
  const today = todayStr();
  if (streak.last_log_date === today || streak.last_log_date === addDays(today, -1)) {
    return streak.current_streak;
  }
  return 0; // broken
}

export const MILESTONES = [7, 14, 30, 60, 100];
