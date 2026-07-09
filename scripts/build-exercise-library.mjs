// Builds public/exercise-library.json from the hasaneyldrm/exercises-dataset repo.
//
// Usage:
//   git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset.git /tmp/exercises-dataset
//   node scripts/build-exercise-library.mjs /tmp/exercises-dataset/data/exercises.json
//
// The app ships this slim JSON (English steps only) plus the dataset's media
// copied into public/exercise-media/{images,videos}, addressed by
// `${id}-${media_id}` — see src/lib/exerciseLibrary.ts. To refresh media:
//   cp -r <dataset>/images public/exercise-media/images
//   cp -r <dataset>/videos public/exercise-media/videos
// Media © Gym visual — https://gymvisual.com/ (attribution required in the UI).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) {
  console.error("Usage: node scripts/build-exercise-library.mjs <path-to-exercises.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(src, "utf8"));
const out = raw.map((e) => ({
  id: e.id,
  name: e.name,
  body_part: e.body_part,
  equipment: e.equipment,
  target: e.target,
  secondary: Array.isArray(e.secondary_muscles) ? e.secondary_muscles : [],
  media: e.media_id,
  steps: e.instruction_steps?.en ?? (e.instructions?.en ? [e.instructions.en] : []),
}));

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "exercise-library.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(`Wrote ${out.length} exercises to ${dest} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
