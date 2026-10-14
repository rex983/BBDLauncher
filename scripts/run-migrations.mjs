// Apply pending supabase/migrations/NNN_*.sql files, in filename order.
//
// Usage (from the repo root):
//   PG_CONN="postgres://..." node scripts/run-migrations.mjs             # apply pending
//   PG_CONN="postgres://..." node scripts/run-migrations.mjs --dry-run   # list pending only
//   PG_CONN="postgres://..." node scripts/run-migrations.mjs --baseline  # mark every current
//                                                                        # file applied, run nothing
//   PG_CONN="postgres://..." node scripts/run-migrations.mjs --baseline=044
//                                      # mark only files numbered <= 044 applied, run nothing
//
// Applied files are recorded in a `schema_migrations(filename, applied_at)`
// ledger, created on first run. Files already in the ledger are skipped, so
// re-running is safe. On an existing database whose migrations were applied
// by hand (or by the older version of this script, which re-ran everything),
// run --baseline ONCE first — but only after confirming every current file
// really is applied. For any file that isn't, delete its ledger row
// (DELETE FROM schema_migrations WHERE filename = '...') before the next
// normal run so it gets applied.
//
// Each file is sent as one query (Postgres runs a multi-statement query as a
// single implicit transaction unless the file has its own BEGIN/COMMIT); its
// ledger row is written once it succeeds. Stops at the first failure.
//
// Needs the `pg` dev dependency (npm install).

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";

const { Client } = pg;

const args = process.argv.slice(2);
const baselineArg = args.find((a) => a === "--baseline" || a.startsWith("--baseline="));
const baseline = !!baselineArg;
// "--baseline=044" stops at that migration number; plain "--baseline" takes all.
const baselineThrough = baselineArg?.includes("=") ? baselineArg.split("=")[1] : null;
if (baselineThrough !== null && !/^\d{3}$/.test(baselineThrough)) {
  console.error("--baseline=NNN takes a three-digit migration number, e.g. --baseline=044");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

const connectionString = process.env.PG_CONN;
if (!connectionString) {
  console.error("Set PG_CONN env var.");
  process.exit(1);
}

const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected.");

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Owner / service role only, like the other launcher tables.
  ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
`);

const { rows } = await client.query("SELECT filename FROM schema_migrations");
const applied = new Set(rows.map((r) => r.filename));
const pending = files.filter((f) => !applied.has(f));

console.log(
  `${files.length} migration files, ${applied.size} recorded as applied, ${pending.length} pending.`,
);
if (pending.length) console.log("Pending:", pending);

if (dryRun || pending.length === 0) {
  await client.end();
  process.exit(0);
}

const record = (f) =>
  client.query(
    "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
    [f],
  );

if (baseline) {
  const marked = pending.filter((f) => baselineThrough === null || f.slice(0, 3) <= baselineThrough);
  for (const f of marked) await record(f);
  console.log(`Baselined ${marked.length} file(s) as applied (nothing was run):`, marked);
  await client.end();
  process.exit(0);
}

for (const f of pending) {
  const sql = readFileSync(join(dir, f), "utf8");
  console.log(`\n== Running ${f} ==`);
  try {
    await client.query(sql);
    await record(f);
    console.log("   ok");
  } catch (err) {
    console.error(`   FAILED: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("\nAll pending migrations applied.");
