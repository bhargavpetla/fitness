"use client";

// App mode: the classic manual tracker vs the AI Coach interface.
//
// The Coach is EARNED — it appears only after 7 consecutive days of logging
// (the app's "watch first, advise later" philosophy). Once earned it never
// re-locks (longest_streak, not current_streak). The chosen mode persists per
// device, so someone who switched to the Coach lands there on every open
// until they switch back. Data is shared either way — both modes read and
// write the same logs.

import type { Streak } from "@/lib/types";

export type AppMode = "manual" | "ai";

const KEY = "app-mode";
export const UNLOCK_DAYS = 7;

export function getMode(): AppMode {
  try {
    return localStorage.getItem(KEY) === "ai" ? "ai" : "manual";
  } catch {
    return "manual";
  }
}

export function setMode(mode: AppMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode — the switch just won't persist */
  }
}

export function coachUnlocked(streak: Streak | null): boolean {
  return (streak?.longest_streak ?? 0) >= UNLOCK_DAYS;
}

// How far along the unlock is, for the "X of 7 days" teaser.
export function unlockProgress(streak: Streak | null): number {
  return Math.min(UNLOCK_DAYS, streak?.current_streak ?? 0);
}
