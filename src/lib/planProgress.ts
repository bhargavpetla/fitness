"use client";

// Deterministic gamification math for AI Coach plans — computed from plan days
// so it's free and always consistent with what the user actually completed.

import type { AiPlan, AiPlanDay } from "@/lib/types";
import { todayStr } from "@/lib/date";

// Index (0-based) of today's entry in the plan's day list, clamped into range.
// Before the start date this is 0; after the end it's the last day.
export function todayIndex(days: AiPlanDay[]): number {
  const t = todayStr();
  const i = days.findIndex((d) => d.date >= t);
  if (i === -1) return Math.max(0, days.length - 1);
  return i;
}

export function completedCount(days: AiPlanDay[]): number {
  return days.filter((d) => d.completed).length;
}

// Days that have already come due (date <= today), the adherence denominator.
export function elapsedCount(days: AiPlanDay[]): number {
  const t = todayStr();
  return days.filter((d) => d.date <= t).length;
}

export function adherencePct(days: AiPlanDay[]): number | null {
  const elapsed = elapsedCount(days);
  if (elapsed === 0) return null;
  const done = days.filter((d) => d.completed && d.date <= todayStr()).length;
  return Math.round((done / elapsed) * 100);
}

// Consecutive completed days counting back from today (or yesterday, so the
// streak isn't broken before the user has had a chance to log today).
export function planStreak(days: AiPlanDay[]): number {
  const t = todayStr();
  const due = days.filter((d) => d.date <= t);
  let streak = 0;
  for (let i = due.length - 1; i >= 0; i--) {
    const d = due[i];
    if (d.completed) streak++;
    else if (d.date === t) continue; // today still open
    else break;
  }
  return streak;
}

export interface Milestone {
  at: number;
  emoji: string;
  label: string;
}

export const MILESTONES: Milestone[] = [
  { at: 3, emoji: "🥉", label: "3 days" },
  { at: 5, emoji: "🥈", label: "5 days" },
  { at: 7, emoji: "🏆", label: "full week" },
];

export function isPlanOver(plan: AiPlan): boolean {
  return plan.end_date < todayStr();
}
