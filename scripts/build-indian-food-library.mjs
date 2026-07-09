// Builds the server-side Indian food data for the AI Coach meal planner:
//
//   src/data/indb-macros.json    — measured per-serving macros for ~1,000 Indian
//                                  dishes (Indian Nutrient Databank / INDB,
//                                  github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-)
//   src/data/indian-recipes.json — 6.8k recipes with image URL, cuisine, course,
//                                  diet and trimmed instructions (Archana's Kitchen
//                                  dataset via github.com/nileshely/Indian-Food +
//                                  huggingface.co/datasets/Anupam007/indian-recipe-dataset)
//
// Usage:
//   node scripts/build-indian-food-library.mjs <INDB.xlsx> <IndianFoodDataset.csv> <Cleaned_Indian_Food_Dataset.csv>
//
// These files are imported by server code only (never shipped to the client).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const [indbPath, originalCsvPath, cleanedCsvPath] = process.argv.slice(2);
if (!indbPath || !originalCsvPath || !cleanedCsvPath) {
  console.error("Usage: node scripts/build-indian-food-library.mjs <INDB.xlsx> <IndianFoodDataset.csv> <Cleaned_Indian_Food_Dataset.csv>");
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
mkdirSync(outDir, { recursive: true });

const r1 = (n) => Math.round(Number(n) * 10) / 10 || 0;

// ---- INDB macros (per serving unit) ----
const wb = XLSX.readFile(indbPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const indb = rows
  .filter((r) => r.food_name && r.unit_serving_energy_kcal > 0)
  .map((r) => ({
    n: String(r.food_name).trim(),
    unit: String(r.servings_unit ?? "serving").trim(),
    kcal: r1(r.unit_serving_energy_kcal),
    p: r1(r.unit_serving_protein_g),
    c: r1(r.unit_serving_carb_g),
    f: r1(r.unit_serving_fat_g),
  }));
writeFileSync(join(outDir, "indb-macros.json"), JSON.stringify(indb));
console.log(`indb-macros.json: ${indb.length} dishes`);

// ---- tiny RFC4180 CSV parser (quoted fields can span lines) ----
function parseCsv(text) {
  const out = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out;
}

function toObjects(rows) {
  const head = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// Course/Diet/Servings live only in the original dataset — join by recipe name.
const original = toObjects(parseCsv(readFileSync(originalCsvPath, "utf8")));
const metaByName = new Map(
  original.map((r) => [r.TranslatedRecipeName, { course: r.Course, diet: r.Diet, servings: r.Servings }])
);

const cleaned = toObjects(parseCsv(readFileSync(cleanedCsvPath, "utf8")));

// Display name: strip "Recipe" filler and any parenthetical/dash translations.
function displayName(raw) {
  return raw
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*-\s*[^-]*$/g, "")
    .replace(/\brecipe\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normKey = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function toSteps(instructions) {
  const parts = instructions
    .split(/\r?\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return parts.slice(0, 10).map((s) => (s.length > 240 ? s.slice(0, 237) + "…" : s));
}

const recipes = [];
const seen = new Set();
for (const r of cleaned) {
  const raw = r.TranslatedRecipeName ?? "";
  const image = (r["image-url"] ?? "").trim();
  if (!raw || !image.startsWith("http")) continue;
  const name = displayName(raw);
  const key = normKey(name);
  if (!key || seen.has(key)) continue;
  seen.add(key);
  const meta = metaByName.get(raw) ?? {};
  recipes.push({
    name,
    key,
    image,
    cuisine: r.Cuisine || "Indian",
    course: meta.course || "",
    diet: meta.diet || "",
    time_min: Number(r.TotalTimeInMins) || null,
    servings: Number(meta.servings) || null,
    steps: toSteps(r.TranslatedInstructions ?? ""),
  });
}
const outPath = join(outDir, "indian-recipes.json");
writeFileSync(outPath, JSON.stringify(recipes));
console.log(`indian-recipes.json: ${recipes.length} recipes (${(JSON.stringify(recipes).length / 1048576).toFixed(1)} MB)`);
