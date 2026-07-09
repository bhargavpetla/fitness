"use client";

// In-progress live workout, persisted to localStorage after every change so a
// locked phone, tab kill, or accidental refresh mid-session loses nothing.
// One session at a time; finishing or discarding clears it.

import type { ExerciseSet } from "@/lib/types";
import type { LibraryExercise } from "@/lib/exerciseLibrary";
import { mediaKey } from "@/lib/exerciseLibrary";

export interface LiveEntry {
  key: string; // unique within the session (same exercise can repeat)
  libId: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondary: string[];
  media: string | null; // `${id}-${media_id}` for library exercises, null for custom
  steps: string[]; // how-to, kept in the entry so the in-workout reference needs no lookup
  sets: ExerciseSet[];
}

export interface LiveSession {
  startedAt: number; // epoch ms
  lastSetAt: number | null; // drives the rest timer
  entries: LiveEntry[];
}

const KEY = "live-workout-v1";

export function loadSession(): LiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LiveSession;
    if (!s || typeof s.startedAt !== "number" || !Array.isArray(s.entries)) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: LiveSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full/disabled — session just won't survive a reload */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function newSession(): LiveSession {
  return { startedAt: Date.now(), lastSetAt: null, entries: [] };
}

export function entryFromLibrary(e: LibraryExercise): LiveEntry {
  return {
    key: `${e.id}-${Date.now()}`,
    libId: e.id,
    name: e.name,
    bodyPart: e.body_part,
    equipment: e.equipment,
    target: e.target,
    secondary: e.secondary,
    media: e.custom ? null : mediaKey(e),
    steps: e.steps,
    sets: [],
  };
}

// Capped so a session forgotten overnight doesn't report a 14-hour workout.
export function sessionDurationMin(s: LiveSession): number {
  return Math.min(240, Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)));
}

// "43:12" for the header timer.
export function fmtElapsed(fromMs: number, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - fromMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
