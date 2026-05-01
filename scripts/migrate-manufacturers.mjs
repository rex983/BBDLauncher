// One-shot migration: pull manufacturer_config + changelog rows from the old
// Order Process DB and insert them into the shared BBD Dashboard DB.
//
// Required env vars:
//   OLD_SUPABASE_URL          (default: https://mauappkwxiebfccayhcw.supabase.co)
//   OLD_SUPABASE_SERVICE_KEY  service-role key for the old project
//   PG_CONN                   pg connection string for the shared DB
//
// Steps:
//   1. SELECT * from old DB via Supabase REST.
//   2. Apply scripts/manufacturer-migration.sql (DDL is idempotent).
//   3. Insert rows into the shared DB with explicit ids preserved.
//   4. Verify counts match.

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OLD_URL = process.env.OLD_SUPABASE_URL || "https://mauappkwxiebfccayhcw.supabase.co";
const OLD_KEY = process.env.OLD_SUPABASE_SERVICE_KEY;
const PG_CONN = process.env.PG_CONN;

if (!OLD_KEY) {
  console.error("Set OLD_SUPABASE_SERVICE_KEY.");
  process.exit(1);
}
if (!PG_CONN) {
  console.error("Set PG_CONN (shared DB pg connection string).");
  process.exit(1);
}

const oldDb = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });

console.log("Exporting from old DB…");
const { data: configs, error: e1 } = await oldDb.from("manufacturer_config").select("*");
if (e1) { console.error("manufacturer_config export failed:", e1.message); process.exit(1); }
const { data: changelog, error: e2 } = await oldDb.from("manufacturer_config_changelog").select("*");
if (e2) { console.error("manufacturer_config_changelog export failed:", e2.message); process.exit(1); }
console.log(`  manufacturer_config: ${configs.length} rows`);
console.log(`  manufacturer_config_changelog: ${changelog.length} rows`);

const client = new pg.Client({ connectionString: PG_CONN, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to shared DB.");

const ddl = readFileSync(resolve(process.cwd(), "scripts/manufacturer-migration.sql"), "utf8");
console.log("Applying DDL…");
await client.query(ddl);
console.log("  ok");

if (configs.length > 0) {
  console.log("Inserting manufacturer_config rows…");
  for (const r of configs) {
    await client.query(
      `INSERT INTO manufacturer_config
        (id, name, sku, sign_now_template_id, deposit_percent, deposit_tiers, active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sku = EXCLUDED.sku,
          sign_now_template_id = EXCLUDED.sign_now_template_id,
          deposit_percent = EXCLUDED.deposit_percent,
          deposit_tiers = EXCLUDED.deposit_tiers,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at`,
      [r.id, r.name, r.sku, r.sign_now_template_id, r.deposit_percent, r.deposit_tiers, r.active, r.created_at, r.updated_at],
    );
  }
  console.log(`  inserted/updated ${configs.length}`);
}

if (changelog.length > 0) {
  console.log("Inserting manufacturer_config_changelog rows…");
  for (const r of changelog) {
    await client.query(
      `INSERT INTO manufacturer_config_changelog
        (id, config_id, config_name, action, changes, user_id, user_email, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
      [r.id, r.config_id, r.config_name, r.action, r.changes, r.user_id, r.user_email, r.created_at],
    );
  }
  console.log(`  inserted ${changelog.length}`);
}

const r1 = await client.query("SELECT count(*)::int AS n FROM manufacturer_config");
const r2 = await client.query("SELECT count(*)::int AS n FROM manufacturer_config_changelog");
console.log(`\nVerification:`);
console.log(`  manufacturer_config:           ${r1.rows[0].n} (source: ${configs.length})`);
console.log(`  manufacturer_config_changelog: ${r2.rows[0].n} (source: ${changelog.length})`);

await client.end();
console.log("\nDone.");
