// One-off audit — dump current 2026 time_off_requests grouped by profile,
// and cross-check against the CSV to find mis-assignments.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSV_PATH =
  "C:/Users/Redir/Downloads/OR Business Dashboard 3.0 2026 - Time Off Dashboard.csv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envSource = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envSource.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const eq = line.indexOf("=");
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
  if (!process.env[k]) process.env[k] = v;
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: profiles } = await supabase
  .from("profiles")
  .select("id, email, full_name, is_active");
const byId = new Map(profiles.map((p) => [p.id, p]));
const byName = new Map();
for (const p of profiles) {
  if (p.full_name) byName.set(p.full_name.trim().toLowerCase(), p);
}

const { data: rows } = await supabase
  .from("time_off_requests")
  .select("id, profile_id, type, start_date, end_date, created_at")
  .gte("created_at", "2026-01-01T00:00:00Z")
  .lt("created_at", "2027-01-01T00:00:00Z");

console.log(`Total 2026 rows: ${rows.length}`);
const byProfile = new Map();
for (const r of rows) {
  const k = r.profile_id;
  byProfile.set(k, (byProfile.get(k) || 0) + 1);
}
console.log("\nRows per profile:");
for (const [pid, count] of [...byProfile.entries()].sort((a, b) => b[1] - a[1])) {
  const lbl = byId.get(pid)?.full_name || byId.get(pid)?.email || pid;
  console.log(`  ${count.toString().padStart(4)}  ${lbl}`);
}

// Parse CSV and count intended rows per employee.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\r") { /* ignore */ }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csv = parseCsv(readFileSync(CSV_PATH, "utf8"));
const csvByName = new Map();
for (const cells of csv.slice(1)) {
  const ts = (cells[0] || "").trim();
  if (!ts || !ts.includes("2026")) continue;
  const name = (cells[2] || "").trim();
  if (!name) continue;
  csvByName.set(name, (csvByName.get(name) || 0) + 1);
}
console.log("\nCSV rows per Employee Requesting (2026):");
for (const [n, c] of [...csvByName.entries()].sort((a, b) => b[1] - a[1])) {
  const resolved = byName.has(n.toLowerCase());
  console.log(`  ${c.toString().padStart(4)}  ${n}${resolved ? "" : " [NOT IN PROFILES]"}`);
}

// Dump Garrett's 2026 rows to inspect created_at vs. CSV timestamps.
const garrett = [...byName.values()].find((p) => p.full_name === "Garrett Ryder");
if (garrett) {
  const gRows = rows
    .filter((r) => r.profile_id === garrett.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  console.log(`\nGarrett Ryder's ${gRows.length} DB rows:`);
  for (const r of gRows) {
    console.log(`  ${r.created_at}  ${r.type}  ${r.start_date}..${r.end_date}`);
  }
}

// Also compare CSV Garrett rows.
const csvGarrettRows = csv.slice(1).filter((c) => (c[2] || "").trim() === "Garrett Ryder" && (c[0] || "").includes("2026"));
console.log(`\nCSV Garrett Ryder rows (${csvGarrettRows.length}):`);
for (const c of csvGarrettRows) {
  console.log(`  ${c[0]}  ${c[5]}  ${c[3]}..${c[4]}`);
}

// Sample: show a few "not in profiles" names' DB counterparts to see what
// they look like in profiles (fuzzy).
console.log("\nProfiles containing partial matches for unresolved names:");
for (const name of csvByName.keys()) {
  if (byName.has(name.toLowerCase())) continue;
  const first = name.split(" ")[0].toLowerCase();
  const hits = profiles.filter((p) => (p.full_name || "").toLowerCase().includes(first));
  if (hits.length) {
    console.log(`  "${name}" ->`);
    for (const h of hits.slice(0, 3)) {
      console.log(`      ${h.full_name} <${h.email}> is_active=${h.is_active}`);
    }
  } else {
    console.log(`  "${name}" -> (no partial match)`);
  }
}
