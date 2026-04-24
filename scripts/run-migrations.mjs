import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";

const { Client } = pg;

const connectionString = process.env.PG_CONN;
if (!connectionString) {
  console.error("Set PG_CONN env var.");
  process.exit(1);
}

const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();

console.log(`Found ${files.length} migration files:`, files);

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected.");

for (const f of files) {
  const sql = readFileSync(join(dir, f), "utf8");
  console.log(`\n== Running ${f} ==`);
  try {
    await client.query(sql);
    console.log(`   ok`);
  } catch (err) {
    console.error(`   FAILED: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("\nAll migrations applied.");
