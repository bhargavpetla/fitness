// Applies supabase/schema.sql to the project's Postgres database directly.
//
// Usage (password comes from the env, never hardcode it):
//   DB_PASSWORD=... node scripts/apply-schema.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL from .env to derive the host. The whole
// schema file is idempotent, so re-running after edits is safe. Requires the
// `pg` package (npm i --no-save pg).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envOf(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = envOf(join(root, ".env"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = process.env.DB_PASSWORD;
if (!password) {
  console.error("Set DB_PASSWORD env var.");
  process.exit(1);
}

const sql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

// Direct connection first; Supabase's session pooler as fallback (direct DNS
// is IPv6-only on newer projects, which some networks can't reach).
const candidates = [
  // This project lives in ap-south-1 (Mumbai) behind the aws-1 pooler.
  { host: "aws-1-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
];

for (const c of candidates) {
  const client = new pg.Client({
    host: c.host,
    port: c.port,
    user: c.user,
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  try {
    await client.connect();
    console.log(`Connected via ${c.host}`);
    await client.query(sql);
    console.log("Schema applied successfully.");
    const { rows } = await client.query(
      `select table_name from information_schema.tables
       where table_schema='public' order by table_name`
    );
    console.log("public tables:", rows.map((r) => r.table_name).join(", "));
    await client.end();
    process.exit(0);
  } catch (e) {
    console.warn(`${c.host}: ${e.code ?? ""} ${e.message}`);
    try { await client.end(); } catch {}
  }
}
console.error("Could not reach the database on any host.");
process.exit(1);
