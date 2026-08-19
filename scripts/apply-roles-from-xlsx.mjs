// Applies office/department/role assignments derived from
// Downloads/roles.xlsx (2026-08-19 revision) to matching profiles in the
// shared Supabase project.
//
// The workbook is embedded as ASSIGNMENTS below because the .xlsx file itself
// isn't reliably available at run time from every host, and the layout is
// simple enough to inline. Names in the workbook that don't match a profile
// (case- and whitespace-insensitive on full_name) are logged and SKIPPED —
// no new profiles are ever created.
//
// Usage:
//   DRY_RUN=1 node scripts/apply-roles-from-xlsx.mjs     # preview only
//   node scripts/apply-roles-from-xlsx.mjs               # apply changes

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("C:/Users/Redir/asc-pricing/node_modules/@supabase/supabase-js");

// Reuse ASC's shared-DB credentials — this writes to profiles which ASC owns.
function loadEnv() {
  const raw = readFileSync("C:/Users/Redir/asc-pricing/.env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// --- Assignments ---------------------------------------------------------
// (name, office, department, role) — role uses the internal snake_case name
// that will exist in launcher_roles / profiles.role after migration 016.
const ASSIGNMENTS = [
  // Harbor / SALES TEAM
  ["Garrett Ryder",         "Harbor", "SALES TEAM", "senior_manager"],
  ["Jason Parcelli",        "Harbor", "SALES TEAM", "junior_manager"],
  ["Kelvin Soto",           "Harbor", "SALES TEAM", "junior_manager"],
  ["Salita",                "Harbor", "SALES TEAM", "team_lead"],
  ["Reed Hunt",             "Harbor", "SALES TEAM", "team_lead"],
  ["Emily Quesada",         "Harbor", "SALES TEAM", "team_lead"],
  ["Aaron Lillibridge",     "Harbor", "SALES TEAM", "sales_rep"],
  ["Adam McDonald",         "Harbor", "SALES TEAM", "sales_rep"],
  ["Aidan Blust",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Alyssa Chase",          "Harbor", "SALES TEAM", "sales_rep"],
  ["Britt Kemen",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Burk Luca",             "Harbor", "SALES TEAM", "sales_rep"],
  ["Cayman Wade",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Chase Murphy",          "Harbor", "SALES TEAM", "sales_rep"],
  ["Dariel Rodriguez",      "Harbor", "SALES TEAM", "sales_rep"],
  ["David Sihanikhom",      "Harbor", "SALES TEAM", "sales_rep"],
  ["Dylan Schmidt",         "Harbor", "SALES TEAM", "sales_rep"],
  ["Evan James",            "Harbor", "SALES TEAM", "sales_rep"],
  ["Evan Smeltzer",         "Harbor", "SALES TEAM", "sales_rep"],
  ["Gabe De Alba",          "Harbor", "SALES TEAM", "sales_rep"],
  ["Gabriel De Alba",       "Harbor", "SALES TEAM", "sales_rep"],
  ["Gabriel DeAlba",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Harry Woodmansee",      "Harbor", "SALES TEAM", "sales_rep"],
  ["Jack Katz",             "Harbor", "SALES TEAM", "sales_rep"],
  ["Jakari Mayers",         "Harbor", "SALES TEAM", "sales_rep"],
  ["Jennie Rickett",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Jesus Cisneros",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Jordan Lemon",          "Harbor", "SALES TEAM", "sales_rep"],
  ["Jordan Socarras",       "Harbor", "SALES TEAM", "sales_rep"],
  ["Kayani Occe",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Liliana Arasimowicz",   "Harbor", "SALES TEAM", "sales_rep"],
  ["Max Wright",            "Harbor", "SALES TEAM", "sales_rep"],
  ["Mo Yasin",              "Harbor", "SALES TEAM", "sales_rep"],
  ["Nicholas Deboe",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Nicholas DeBoe",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Ray Cavallo",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Rob Lopez",             "Harbor", "SALES TEAM", "sales_rep"],
  ["Sam farabaugh",         "Harbor", "SALES TEAM", "sales_rep"],
  ["Samantha Farabaugh",    "Harbor", "SALES TEAM", "sales_rep"],
  ["Tom Woodmansee",        "Harbor", "SALES TEAM", "sales_rep"],
  ["Tucker Fine",           "Harbor", "SALES TEAM", "sales_rep"],
  ["Ty Simpson",            "Harbor", "SALES TEAM", "sales_rep"],
  ["Tyler Hughes",          "Harbor", "SALES TEAM", "sales_rep"],
  ["Yesha Pandit",          "Harbor", "SALES TEAM", "sales_rep"],

  // Marion / SALES TEAM
  ["Robin Campbell",        "Marion", "SALES TEAM", "senior_manager"],
  ["Bill Alexander",        "Marion", "SALES TEAM", "sales_rep"],
  ["Nick Brunsman",         "Marion", "SALES TEAM", "sales_rep"],
  ["Rob Salaita",           "Marion", "SALES TEAM", "sales_rep"],
  ["Samantha Napoli",       "Marion", "SALES TEAM", "sales_rep"],
  ["Timothy Hickman",       "Marion", "SALES TEAM", "sales_rep"],

  // BST / BST
  ["Ryan Hamilton",         "BST",    "BST",        "senior_manager"],
  ["Brian Bates",           "BST",    "BST",        "senior_manager"],
  ["Jacob Reynolds",        "BST",    "BST",        "cancellations_dept"],
  ["Mayson Dunnigan",       "BST",    "BST",        "revisions_dept"],
  ["Tim Reynolds",          "BST",    "BST",        "revisions_dept"],

  // RnD / RnD
  ["Keshav",                "RnD",    "RnD",        "admin"],
  ["Rex",                   "RnD",    "RnD",        "admin"],
  ["Andrew",                "RnD",    "RnD",        "rnd"],
];

// --- Workbook-spelling overrides ---------------------------------------
// Manual fixes where the workbook name has a typo or format variance vs.
// the profile's full_name. Keyed by the normalized workbook cell text,
// value is the email of the profile to update. Applied BEFORE the fuzzy
// match so we don't rely on fragile heuristics for known cases.
const NAME_OVERRIDES = {
  "jason parcelli": "jason@bigbuildingsdirect.com",  // Porcelli in profile, Parcelli in workbook
  "gabriel de alba": "gabe@bigbuildingsdirect.com",  // De-Alba (hyphenated) in profile
};

// --- Matching helpers ---------------------------------------------------
function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// --- Fetch profiles -----------------------------------------------------
async function fetchProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, office, department");
  if (error) {
    // department column may not exist yet on a stale schema — retry without.
    if (/column .*department/i.test(error.message)) {
      const retry = await supabase
        .from("profiles")
        .select("id, email, full_name, role, office");
      if (retry.error) throw retry.error;
      return retry.data.map((p) => ({ ...p, department: null }));
    }
    throw error;
  }
  return data;
}

// --- Main ---------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

async function main() {
  const profiles = await fetchProfiles();
  console.log(`Loaded ${profiles.length} profiles`);

  const byExactName = new Map();
  const byFirstOnly = new Map();
  const byEmail = new Map();
  for (const p of profiles) {
    byEmail.set(p.email.toLowerCase(), p);
    if (!p.full_name) continue;
    const key = normalizeName(p.full_name);
    if (!byExactName.has(key)) byExactName.set(key, []);
    byExactName.get(key).push(p);
    const first = key.split(" ")[0];
    if (first) {
      if (!byFirstOnly.has(first)) byFirstOnly.set(first, []);
      byFirstOnly.get(first).push(p);
    }
  }

  const matched = [];
  const skipped = [];
  const ambiguous = [];
  const seenProfileIds = new Set();

  for (const [rawName, office, department, role] of ASSIGNMENTS) {
    const key = normalizeName(rawName);
    let hits;
    let matchType = "exact";

    const overrideEmail = NAME_OVERRIDES[key];
    if (overrideEmail) {
      const p = byEmail.get(overrideEmail.toLowerCase());
      if (p) {
        hits = [p];
        matchType = "override";
      }
    }

    if (!hits) hits = byExactName.get(key);
    if ((!hits || hits.length === 0) && !key.includes(" ")) {
      const cand = byFirstOnly.get(key);
      if (cand && cand.length === 1) {
        hits = cand;
        matchType = "first-only";
      } else if (cand && cand.length > 1) {
        ambiguous.push({ rawName, office, department, role, candidates: cand.map((c) => c.full_name) });
        continue;
      }
    }
    if (!hits || hits.length === 0) {
      skipped.push({ rawName, office, department, role });
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push({ rawName, office, department, role, candidates: hits.map((c) => c.full_name) });
      continue;
    }
    const p = hits[0];
    if (seenProfileIds.has(p.id)) continue; // workbook duplicate (Gabe/Gabriel/etc)
    seenProfileIds.add(p.id);
    matched.push({ rawName, profile: p, office, department, role, matchType });
  }

  console.log(`\n=== MATCHED (${matched.length}) ===`);
  for (const m of matched) {
    const chg = [];
    if (m.profile.office !== m.office) chg.push(`office ${m.profile.office || "-"}→${m.office}`);
    if ((m.profile.department || null) !== m.department) chg.push(`dept ${m.profile.department || "-"}→${m.department}`);
    if (m.profile.role !== m.role) chg.push(`role ${m.profile.role || "-"}→${m.role}`);
    const tag = m.matchType === "first-only" ? " [first-only]" : m.matchType === "override" ? " [override]" : "";
    const suffix = chg.length ? `  { ${chg.join(", ")} }` : "  (no change)";
    console.log(`  ${m.rawName.padEnd(24)} → ${m.profile.full_name} <${m.profile.email}>${tag}${suffix}`);
  }

  console.log(`\n=== SKIPPED — no profile match (${skipped.length}) ===`);
  for (const s of skipped) console.log(`  ${s.rawName}  (${s.office}/${s.department}/${s.role})`);

  if (ambiguous.length) {
    console.log(`\n=== AMBIGUOUS (${ambiguous.length}) ===`);
    for (const a of ambiguous) console.log(`  ${a.rawName} → [${a.candidates.join(", ")}]`);
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — no changes written.");
    return;
  }

  console.log("\nApplying updates...");
  let updated = 0, noChange = 0, failed = 0;
  for (const m of matched) {
    const sameOffice = m.profile.office === m.office;
    const sameDept = (m.profile.department || null) === m.department;
    const sameRole = m.profile.role === m.role;
    if (sameOffice && sameDept && sameRole) { noChange++; continue; }
    const { data: cur } = await supabase
      .from("profiles").select("session_version").eq("id", m.profile.id).single();
    const { error } = await supabase.from("profiles").update({
      office: m.office,
      department: m.department,
      role: m.role,
      session_version: ((cur?.session_version ?? 0) + 1),
    }).eq("id", m.profile.id);
    if (error) { failed++; console.error(`  FAIL ${m.profile.email}: ${error.message}`); }
    else updated++;
  }
  console.log(`\nDone. Updated=${updated} NoChange=${noChange} Failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
