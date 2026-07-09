import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Server-side matcher from AI-suggested exercise names to the bundled exercise
// library (public/exercise-library.json) so plan days carry real animation
// media keys and how-to steps.

interface LibRow {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary: string[];
  media: string;
  steps: string[];
}

let cache: LibRow[] | null = null;

function lib(): LibRow[] {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(join(process.cwd(), "public", "exercise-library.json"), "utf8")
    ) as LibRow[];
  }
  return cache;
}

const ALIASES: Record<string, string> = {
  db: "dumbbell",
  bb: "barbell",
  kb: "kettlebell",
  bw: "body",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  lat: "lat",
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export interface ExerciseMatch {
  media: string; // `${id}-${media}` key for GIF/thumb
  target: string;
  steps: string[];
}

export function matchExercise(name: string): ExerciseMatch | null {
  const expanded = norm(name)
    .split(" ")
    .map((t) => ALIASES[t] ?? t)
    .join(" ");
  const qTokens = new Set(expanded.split(" ").filter(Boolean));
  if (qTokens.size === 0) return null;

  let best: LibRow | null = null;
  let bestScore = 0;
  for (const r of lib()) {
    // Unique tokens, or duplicated words ("leg press on leg press") double-count.
    const tokens = [...new Set(norm(r.name).split(" "))];
    let hit = 0;
    for (const t of tokens) if (qTokens.has(t)) hit++;
    const coverageLib = hit / tokens.length; // how much of the lib name we matched
    const coverageQ = Math.min(1, hit / qTokens.size); // how much of the query we used
    if (coverageQ < 0.6) continue;
    const score = coverageQ * 100 + coverageLib * 50 - tokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return null;
  return {
    media: `${best.id}-${best.media}`,
    target: best.target,
    steps: best.steps.slice(0, 8),
  };
}
