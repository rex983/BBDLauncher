// Quick smoke test — verifies manufacturer data is intact in the shared DB
// and round-trips a write via the launcher's Supabase service-role client.
import pg from "pg";

const PG_CONN = process.env.PG_CONN;
if (!PG_CONN) {
  console.error("Set PG_CONN.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: PG_CONN, ssl: { rejectUnauthorized: false } });
await client.connect();

const cfg = await client.query("SELECT count(*)::int AS n FROM manufacturer_config");
const cl = await client.query("SELECT count(*)::int AS n FROM manufacturer_config_changelog");
console.log(`manufacturer_config rows:           ${cfg.rows[0].n}`);
console.log(`manufacturer_config_changelog rows: ${cl.rows[0].n}`);

const sample = await client.query(`
  SELECT id, name, sku, sign_now_template_id, deposit_percent, deposit_tiers, active
  FROM manufacturer_config
  ORDER BY name
  LIMIT 5
`);
console.log("\nFirst 5 manufacturers:");
for (const r of sample.rows) {
  console.log(`  - ${r.name} (sku=${r.sku ?? "—"}, deposit=${r.deposit_percent ?? "—"}%, tiers=${r.deposit_tiers ? "yes" : "no"}, active=${r.active})`);
}

console.log("\nRLS sanity — get_user_role() function exists?");
const fn = await client.query(`
  SELECT proname FROM pg_proc WHERE proname = 'get_user_role' LIMIT 1
`);
console.log(`  ${fn.rows.length === 1 ? "yes" : "MISSING"}`);

console.log("\nRLS policies on manufacturer_config:");
const pols = await client.query(`
  SELECT polname, polcmd FROM pg_policy
  JOIN pg_class ON pg_policy.polrelid = pg_class.oid
  WHERE pg_class.relname IN ('manufacturer_config', 'manufacturer_config_changelog')
  ORDER BY pg_class.relname, polname
`);
for (const r of pols.rows) {
  console.log(`  - ${r.polname} (${r.polcmd})`);
}

console.log("\nProfile office column has CHECK constraint?");
const chk = await client.query(`
  SELECT pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'profiles' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%office%'
`);
for (const r of chk.rows) {
  console.log(`  ${r.def}`);
}

await client.end();
console.log("\nDone.");
