"use client";

// Exercise library for the live workout logger. The slim catalog
// (public/exercise-library.json, built by scripts/build-exercise-library.mjs)
// is fetched once when the picker opens and cached for the session. Media
// (GIF + 180×180 thumbnail per exercise) lives in public/exercise-media.
// Media © Gym visual — https://gymvisual.com/ — attribution must stay visible
// wherever the animations are shown.

import type { CustomExercise } from "@/lib/types";

export interface LibraryExercise {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary: string[];
  media: string; // media_id — file basename is `${id}-${media}`
  steps: string[];
  custom?: boolean; // user-added exercise (no media)
}

export const MEDIA_ATTRIBUTION = "Animations © Gym visual";

export function thumbUrl(e: Pick<LibraryExercise, "id" | "media">): string | null {
  return e.media ? `/exercise-media/images/${e.id}-${e.media}.jpg` : null;
}

export function gifUrl(e: Pick<LibraryExercise, "id" | "media">): string | null {
  return e.media ? `/exercise-media/videos/${e.id}-${e.media}.gif` : null;
}

// Thumbnail/GIF address stored on a logged exercise (`media` on
// ParsedStrengthExercise) so the workout detail screen can render real media.
export function mediaKey(e: Pick<LibraryExercise, "id" | "media">): string | null {
  return e.media ? `${e.id}-${e.media}` : null;
}

export function thumbUrlFromKey(key: string): string {
  return `/exercise-media/images/${key}.jpg`;
}

// ---- muscle groups (step 1 of the picker) ----
// The dataset's body_part vocabulary, ordered and labeled the way a lifter
// thinks ("Chest", "Biceps & Triceps"), not the way an anatomy chart does.

export interface MuscleGroup {
  key: string; // dataset body_part value
  label: string;
  icon: string; // emoji — the grid stays light, no thumbnails to load
  hint: string; // the targets inside, as a subtitle
}

export const MUSCLE_GROUPS: MuscleGroup[] = [
  { key: "chest", label: "Chest", icon: "🫁", hint: "pecs" },
  { key: "back", label: "Back", icon: "🦅", hint: "lats · upper back · spine" },
  { key: "shoulders", label: "Shoulders", icon: "🏔️", hint: "delts" },
  { key: "upper arms", label: "Arms", icon: "💪", hint: "biceps · triceps" },
  { key: "lower arms", label: "Forearms", icon: "🤝", hint: "grip · forearms" },
  { key: "upper legs", label: "Legs", icon: "🦵", hint: "quads · hams · glutes" },
  { key: "lower legs", label: "Calves", icon: "🧦", hint: "calves" },
  { key: "waist", label: "Core", icon: "🎯", hint: "abs · obliques" },
  { key: "cardio", label: "Cardio", icon: "🏃", hint: "conditioning" },
  { key: "neck", label: "Neck", icon: "🧣", hint: "levator scapulae" },
];

// ---- catalog loading ----

let cache: LibraryExercise[] | null = null;
let inflight: Promise<LibraryExercise[]> | null = null;

export async function loadLibrary(): Promise<LibraryExercise[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/exercise-library.json")
    .then((r) => {
      if (!r.ok) throw new Error("library fetch failed");
      return r.json();
    })
    .then((data: LibraryExercise[]) => {
      cache = data;
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function customToLibrary(c: CustomExercise): LibraryExercise {
  return {
    id: `custom-${c.id}`,
    name: c.name,
    body_part: c.body_part,
    equipment: c.equipment,
    target: c.target,
    secondary: [],
    media: "",
    steps: [],
    custom: true,
  };
}

// ---- filtering & search ----

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "");

// Every query token must appear somewhere in name/equipment/target, so
// "db curl" finds "dumbbell biceps curl". Cheap and good enough for 1.3k rows.
const ALIASES: Record<string, string> = { db: "dumbbell", bb: "barbell", kb: "kettlebell", bw: "body weight" };

export function searchLibrary(all: LibraryExercise[], query: string, bodyPart?: string | null): LibraryExercise[] {
  let pool = bodyPart ? all.filter((e) => e.body_part === bodyPart) : all;
  const q = norm(query).trim();
  if (q) {
    const tokens = q.split(/\s+/).map((t) => ALIASES[t] ?? t);
    pool = pool.filter((e) => {
      const hay = norm(`${e.name} ${e.equipment} ${e.target}`);
      return tokens.every((t) => hay.includes(t));
    });
  }
  return pool;
}

// ---- recents ----
// Lifters repeat the same movements week to week; the picker surfaces the last
// dozen picked exercises so a typical session is two taps per exercise.

const RECENTS_KEY = "exercise-recents-v1";

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): void {
  try {
    const ids = [id, ...getRecents().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

// Equipment values present in a pool, most common first — powers the filter chips.
export function equipmentOf(pool: LibraryExercise[]): string[] {
  const counts = new Map<string, number>();
  for (const e of pool) counts.set(e.equipment, (counts.get(e.equipment) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
