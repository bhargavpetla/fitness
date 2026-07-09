import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Server-side Indian food data for the AI Coach meal planner.
// Built by scripts/build-indian-food-library.mjs — see that file for sources
// (INDB measured macros; Archana's Kitchen recipes/images).

export interface IndbDish {
  n: string; // dish name
  unit: string; // serving unit, e.g. "katori", "piece"
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface RecipeEntry {
  name: string;
  key: string; // normalized name for matching
  image: string;
  cuisine: string;
  course: string;
  diet: string;
  time_min: number | null;
  servings: number | null;
  steps: string[];
}

let indbCache: IndbDish[] | null = null;
let recipeCache: RecipeEntry[] | null = null;

// Literal process.cwd() joins so Vercel's file tracer bundles the JSON.
export function loadIndb(): IndbDish[] {
  if (!indbCache) {
    indbCache = JSON.parse(
      readFileSync(join(process.cwd(), "src", "data", "indb-macros.json"), "utf8")
    ) as IndbDish[];
  }
  return indbCache;
}

export function loadRecipes(): RecipeEntry[] {
  if (!recipeCache) {
    recipeCache = JSON.parse(
      readFileSync(join(process.cwd(), "src", "data", "indian-recipes.json"), "utf8")
    ) as RecipeEntry[];
  }
  return recipeCache;
}

// Compact grounding table injected into the meal-plan prompt so suggested
// macros come from measured Indian data instead of model guesses.
export function indbPromptTable(): string {
  return loadIndb()
    .map((d) => `${d.n} | 1 ${d.unit} | ${d.kcal} kcal | P${d.p} C${d.c} F${d.f}`)
    .join("\n");
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// Matches an AI-suggested dish name to a recipe (image + steps). A candidate
// qualifies when the dish name is fully contained in the recipe name ("Poha" →
// "Kanda Poha") or most of the recipe name appears in the dish. Scoring favors
// tight matches with few extra words; an unmatched meal just renders with a
// placeholder, so precision beats recall here.
export function matchRecipe(dish: string): RecipeEntry | null {
  const dishTokens = new Set(norm(dish).split(" ").filter(Boolean));
  if (dishTokens.size === 0) return null;
  let best: RecipeEntry | null = null;
  let bestScore = 0;
  for (const r of loadRecipes()) {
    const tokens = [...new Set(r.key.split(" "))];
    if (tokens.length === 0 || tokens.length > dishTokens.size + 4) continue;
    let hit = 0;
    for (const t of tokens) if (dishTokens.has(t)) hit++;
    const covKey = hit / tokens.length; // recipe-name words found in the dish
    const covDish = hit / dishTokens.size; // dish words found in the recipe name
    if (covDish < 1 && covKey < 0.75) continue;
    const score = covKey * 100 + covDish * 80 - tokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function imageKeyOf(r: RecipeEntry): string {
  return r.key.replace(/\s+/g, "-").slice(0, 80);
}
