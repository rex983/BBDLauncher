// Import 2026 time-off rows from the retired Google Form CSV into
// time_off_requests. Idempotent — re-runs skip rows that already exist
// with the same (profile_id, type, start_date, end_date, created_at).
//
// The requesting employee is resolved by NAME only (col 2 "Employee
// Requesting"). The Email Address column (col 1) is the form owner, not
// the person taking time off, and MUST NOT be used as a fallback.
//
// In addition to inserting missing rows, the script reconciles existing
// DB rows against the CSV by (type, start_date, end_date, created_at):
//   - DB row with the wrong profile_id  → UPDATE to the correct one
//   - DB row matching an unresolvable   → DELETE (was created by a prior
//     CSV row (name-lookup misses)         run that used an email fallback)
//
// Usage:
//   node scripts/import-timeoff-2026.mjs                 # dry-run
//   node scripts/import-timeoff-2026.mjs --commit        # write changes
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
// .env.local (auto-loaded).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CSV_PATH =
  "C:/Users/Redir/Downloads/OR Business Dashboard 3.0 2026 - Time Off Dashboard.csv";
const DECIDED_BY_NAME = "Garrett Ryder";
const COMMIT = process.argv.includes("--commit");
// By default --commit only reconciles (reassign/delete). Inserts require
// an explicit flag so we never double-import over app-created rows.
const INSERT_MISSING = process.argv.includes("--insert-missing");

// Name aliases — the CSV's "Employee Requesting" cell is freeform and does
// not always match the profile's full_name exactly. Add mappings here as
// mismatches surface.
const NAME_ALIASES = {
  "gabriel dealba": "Gabriel De-Alba",
  "salita bangochea": "Salita Bengochea",
  // Prior import treated "Harry Woodmansee" as Tom Woodmansee — CSV has
  // 7 Harry rows and no Tom rows, and Tom has 6 DB records that all
  // correspond to Harry CSV entries. Keep them attached to Tom.
  "harry woodmansee": "Tom Woodmansee",
};

// Subcategory taxonomy — mirrors src/lib/timeoff/types.ts. Kept inline so
// the script has no build-time dependency on the app.
const TIME_OFF_SUBCATEGORIES = {
  personal: [
    "Illness or injury",
    "Mental health",
    "Appointments",
    "Family emergencies",
    "Personal development",
    "Other",
  ],
  vacation: ["Planned vacations", "Sabbaticals", "Staycations"],
  parental: ["Maternity leave", "Paternity leave", "Family leave"],
  sick: ["Short-term illness", "Chronic illness", "Disability leave"],
  other: [],
};

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const envSource = readFileSync(envPath, "utf8");
for (const line of envSource.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const eq = line.indexOf("=");
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas + doubled quotes)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\r") {
        // ignore
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
// Parse "M/D/YYYY [H:MM:SS]" (US locale, no leading zeros). Returns ISO or null.
function parseUsDateTime(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const [, mo, d, y, h = "0", mi = "0", se = "0"] = m;
  // Treat as US/Eastern-ish naive time — the app renders dates only for
  // start/end and shows created_at in the viewer's TZ. Anchoring to UTC
  // preserves the display date and keeps ordering stable across imports.
  const iso = new Date(
    Date.UTC(+y, +mo - 1, +d, +h, +mi, +se),
  ).toISOString();
  return iso;
}

// Parse "M/D/YYYY" → "YYYY-MM-DD".
function parseUsDate(raw) {
  const iso = parseUsDateTime(raw);
  return iso ? iso.slice(0, 10) : null;
}

const TYPE_MAP = {
  "Vacation & Leisure": "vacation",
  Vacation: "vacation",
  Sick: "sick",
  Personal: "personal",
  Parental: "parental",
  Other: "other",
};

const STATUS_MAP = {
  Approved: "approved",
  Denied: "denied",
  Pending: "pending",
  "Not Needed": "cancelled",
  "Need More Info": "pending", // prepends tag into reason
  "": "pending",
};

// Extract subcategory from "Short-term illness: Taking time off ..." →
// "Short-term illness". If the string is a bare label (no colon) or "Other",
// returns null.
function extractSubcategory(type, requestTypeCell) {
  const s = (requestTypeCell || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "other") return null;
  const label = s.includes(":") ? s.split(":")[0].trim() : s;
  const allowed = TIME_OFF_SUBCATEGORIES[type] || [];
  return allowed.find((a) => a.toLowerCase() === label.toLowerCase()) || null;
}

// ---------------------------------------------------------------------------
// Load CSV + parse rows
// ---------------------------------------------------------------------------
const raw = readFileSync(CSV_PATH, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const dataRows = rows.slice(1);

// Column indices (0-based, based on the header).
const COL = {
  timestamp: 0,
  submitterEmail: 1,
  employeeName: 2,
  startDate: 3,
  endDate: 4,
  typeLabel: 5,
  uploadUrl: 11,
  notes: 12,
  requestTypeFlat: 20,
  // Mirror block also has upload+notes at 21/22; the flat request type at
  // 20 is the merged "one subcategory string" the sheet builds.
  approval: 24,
  decidedAt: 26,
};

// ---------------------------------------------------------------------------
// Fetch profiles for name → UUID resolution
// ---------------------------------------------------------------------------
const { data: profiles, error: pErr } = await supabase
  .from("profiles")
  .select("id, email, full_name, is_active");
if (pErr) {
  console.error("Failed to load profiles:", pErr.message);
  process.exit(1);
}

// Case-insensitive name index (full_name → profile). We deliberately do
// NOT index by email — col 1 in the CSV is the form owner, not the
// requesting employee, and using it as a fallback silently misassigns
// records.
const byName = new Map();
for (const p of profiles) {
  if (p.full_name) byName.set(p.full_name.trim().toLowerCase(), p);
}

const decider = byName.get(DECIDED_BY_NAME.toLowerCase());
if (!decider) {
  console.error(`decided_by profile "${DECIDED_BY_NAME}" not found in profiles table`);
  process.exit(1);
}
console.log(`decided_by = ${decider.full_name} (${decider.id})`);

// Also index profiles by id for reverse lookup during reconciliation.
const byId = new Map();
for (const p of profiles) byId.set(p.id, p);

// ---------------------------------------------------------------------------
// Fetch existing time_off_requests for dedupe + reconciliation
// ---------------------------------------------------------------------------
const { data: existing, error: eErr } = await supabase
  .from("time_off_requests")
  .select("id, profile_id, type, start_date, end_date, created_at")
  .gte("created_at", "2026-01-01T00:00:00Z")
  .lt("created_at", "2027-01-01T00:00:00Z");
if (eErr) {
  console.error("Failed to load existing requests:", eErr.message);
  process.exit(1);
}
// Normalize created_at to a canonical ISO string so DB (`+00:00`) and
// parser (`.000Z`) representations compare equal.
const normalizeIso = (s) => (s ? new Date(s).toISOString() : s);

// Full tuple (including profile_id) — used to detect exact duplicates.
const existingKeys = new Set(
  existing.map(
    (r) =>
      `${r.profile_id}|${r.type}|${r.start_date}|${r.end_date}|${normalizeIso(r.created_at)}`,
  ),
);
// Content tuple (no profile_id) → DB row list — used to spot rows attached
// to the wrong person. Multiple DB rows can share the tuple in the wild;
// we handle that by matching them all.
const existingByContent = new Map();
for (const r of existing) {
  const k = `${r.type}|${r.start_date}|${r.end_date}|${normalizeIso(r.created_at)}`;
  if (!existingByContent.has(k)) existingByContent.set(k, []);
  existingByContent.get(k).push(r);
}
console.log(`Existing 2026 rows in DB: ${existing.length}`);

// ---------------------------------------------------------------------------
// Build insert payload
// ---------------------------------------------------------------------------
const toInsert = [];
const toReassign = []; // {rowId, from, to, name, key}
const toDelete = []; // {rowId, currentProfileId, name, key} — CSV name unresolvable
const unresolvedNames = new Map(); // name → count
const badSubcategories = []; // {name, type, sub}
const fixedDates = []; // {name, orig}
const skippedNoTimestamp = [];
let statusCounts = {};
let typeCounts = {};

for (const cells of dataRows) {
  if (!cells[COL.timestamp]?.trim()) {
    // Trailing decision-only rows have no timestamp. Skip silently unless
    // they carry any request data (they don't in this CSV).
    if (cells.some((c, i) => i !== COL.decidedAt && c?.trim())) {
      skippedNoTimestamp.push(cells);
    }
    continue;
  }

  const createdAt = parseUsDateTime(cells[COL.timestamp]);
  if (!createdAt) continue;
  // Filter to 2026 by timestamp year.
  if (!createdAt.startsWith("2026-")) continue;

  const name = (cells[COL.employeeName] || "").trim();
  // Strict name-only lookup with alias table. The Email Address column
  // is the form owner, not the requesting employee, so we do not fall
  // back to it.
  const nameKey = name.toLowerCase();
  const aliased = NAME_ALIASES[nameKey];
  const profile =
    byName.get(nameKey) ||
    (aliased ? byName.get(aliased.toLowerCase()) : null) ||
    null;

  const typeLabel = (cells[COL.typeLabel] || "").trim();
  const type = TYPE_MAP[typeLabel];
  if (!type) {
    console.warn(`Skipping row: unknown type "${typeLabel}" for ${name}`);
    continue;
  }

  let startDate = parseUsDate(cells[COL.startDate]);
  let endDate = parseUsDate(cells[COL.endDate]);
  if (!startDate || !endDate) {
    console.warn(`Skipping row: bad dates for ${name} (${cells[COL.timestamp]})`);
    continue;
  }
  if (endDate < startDate) {
    fixedDates.push({ name, start: startDate, end: endDate });
    endDate = startDate;
  }

  // Content key — used both for dedupe and for finding existing DB rows
  // that may be attached to the wrong person.
  const contentKey = `${type}|${startDate}|${endDate}|${parseUsDateTime(cells[COL.timestamp])}`;

  if (!profile) {
    unresolvedNames.set(name, (unresolvedNames.get(name) || 0) + 1);
    // If a prior run's email fallback created a DB row for this CSV row,
    // it's now orphaned — attached to the wrong profile with no way to
    // remap. Queue it for deletion.
    for (const dbRow of existingByContent.get(contentKey) || []) {
      toDelete.push({
        rowId: dbRow.id,
        currentProfileId: dbRow.profile_id,
        name,
        key: contentKey,
      });
    }
    continue;
  }

  const flatRequestType = cells[COL.requestTypeFlat] || "";
  const subcategory = extractSubcategory(type, flatRequestType);

  // For 'other' type, or subcategory-less types (empty request type), fall
  // back to putting the freeform text in reason.
  const notes = (cells[COL.notes] || "").trim();
  const uploadUrl = (cells[COL.uploadUrl] || "").trim();
  const approvalRaw = (cells[COL.approval] || "").trim();
  const needsInfo = approvalRaw === "Need More Info";

  const reasonPieces = [];
  if (needsInfo) reasonPieces.push("[Need More Info]");
  // If we couldn't map subcategory (e.g., "Other" or freeform), and the
  // request type flat cell has meaningful text (not just "Other"), keep it
  // in the reason for context.
  if (!subcategory && flatRequestType && flatRequestType.trim().toLowerCase() !== "other") {
    reasonPieces.push(flatRequestType.trim());
  }
  if (notes) reasonPieces.push(notes);
  if (uploadUrl) reasonPieces.push(`Attachment: ${uploadUrl}`);
  const reason = reasonPieces.join(" | ") || null;

  const status = STATUS_MAP[approvalRaw] ?? "pending";
  const decidedAt = parseUsDateTime(cells[COL.decidedAt]);

  // Subcategory sanity: if extracted but not valid for type, log and drop.
  if (subcategory && !(TIME_OFF_SUBCATEGORIES[type] || []).includes(subcategory)) {
    badSubcategories.push({ name, type, sub: subcategory });
  }

  const record = {
    profile_id: profile.id,
    type,
    subcategory,
    start_date: startDate,
    end_date: endDate,
    full_day: true,
    hours: null,
    reason,
    status,
    decided_by: status === "pending" ? null : decider.id,
    decided_at: status === "pending" ? null : decidedAt,
    decided_note: null,
    attachments: [],
    created_at: createdAt,
  };

  const key = `${record.profile_id}|${record.type}|${record.start_date}|${record.end_date}|${record.created_at}`;
  if (existingKeys.has(key)) continue;

  // If a DB row already exists with the same content but a different
  // profile_id, this is a mis-assignment from a prior run. Reassign
  // instead of inserting a duplicate.
  const candidates = (existingByContent.get(contentKey) || []).filter(
    (r) => r.profile_id !== record.profile_id,
  );
  if (candidates.length > 0) {
    // Pick the first candidate; if multiple exist we reassign them all.
    for (const dbRow of candidates) {
      toReassign.push({
        rowId: dbRow.id,
        from: dbRow.profile_id,
        to: record.profile_id,
        name,
        key: contentKey,
      });
    }
    // Track so a subsequent CSV row with the same content doesn't try to
    // reassign the same DB row twice.
    existingByContent.set(contentKey, []);
    existingKeys.add(key);
    continue;
  }

  existingKeys.add(key);
  toInsert.push(record);
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  typeCounts[type] = (typeCounts[type] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("");
console.log("=== Import summary ===");
console.log(`Rows to insert: ${toInsert.length}`);
console.log(`Rows to reassign (fix wrong profile_id): ${toReassign.length}`);
console.log(`Rows to delete (CSV name unresolvable): ${toDelete.length}`);
console.log("By status:", statusCounts);
console.log("By type:", typeCounts);
if (toReassign.length) {
  console.log("");
  console.log("Reassignments:");
  for (const r of toReassign) {
    const fromLbl = byId.get(r.from)?.full_name || r.from;
    const toLbl = byId.get(r.to)?.full_name || r.to;
    console.log(`  - ${r.rowId}: ${fromLbl} → ${toLbl} (${r.name}, ${r.key})`);
  }
}
if (toDelete.length) {
  console.log("");
  console.log("Deletions (orphaned from email-fallback bug):");
  for (const d of toDelete) {
    const curLbl = byId.get(d.currentProfileId)?.full_name || d.currentProfileId;
    console.log(`  - ${d.rowId}: attached to ${curLbl}, CSV name "${d.name}" unresolvable (${d.key})`);
  }
}
if (fixedDates.length) {
  console.log(`End-date-before-start fixes: ${fixedDates.length}`);
  for (const f of fixedDates) console.log(`  - ${f.name}: ${f.start} → ${f.end} (clamped)`);
}
if (badSubcategories.length) {
  console.log(`Subcategories that failed validation: ${badSubcategories.length}`);
  for (const b of badSubcategories) console.log(`  - ${b.name} (${b.type}): "${b.sub}"`);
}
if (unresolvedNames.size) {
  console.log(`Unresolved employee names (skipped): ${unresolvedNames.size}`);
  for (const [n, c] of [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${n || "(blank)"} × ${c}`);
  }
}
if (skippedNoTimestamp.length) {
  console.log(`Rows with no timestamp but other data (unexpected): ${skippedNoTimestamp.length}`);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------
if (!COMMIT) {
  console.log("");
  console.log("Dry run only. Re-run with --commit to write.");
  console.log("(Add --insert-missing to also insert new rows.)");
  process.exit(0);
}

// Safety default: --commit alone only reassigns/deletes existing rows.
// Inserting fresh rows requires --insert-missing to avoid double-adding
// records that may already exist under a different created_at format.
if (!INSERT_MISSING && toInsert.length) {
  console.log(
    `Skipping ${toInsert.length} inserts (add --insert-missing to include them).`,
  );
  toInsert.length = 0;
}

if (toInsert.length === 0 && toReassign.length === 0 && toDelete.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// Reassign first — clears the mis-attached DB rows before we try to
// insert (which uses the same content tuple as a dedupe key).
if (toReassign.length) {
  console.log("");
  console.log(`Reassigning ${toReassign.length} row(s)…`);
  for (const r of toReassign) {
    const { error } = await supabase
      .from("time_off_requests")
      .update({ profile_id: r.to })
      .eq("id", r.rowId);
    if (error) {
      console.error(`Reassign ${r.rowId} failed:`, error.message);
      process.exit(1);
    }
  }
  console.log("  done.");
}

if (toDelete.length) {
  console.log("");
  console.log(`Deleting ${toDelete.length} orphaned row(s)…`);
  const ids = toDelete.map((d) => d.rowId);
  const { error } = await supabase
    .from("time_off_requests")
    .delete()
    .in("id", ids);
  if (error) {
    console.error(`Delete failed:`, error.message);
    process.exit(1);
  }
  console.log("  done.");
}

if (toInsert.length) {
  console.log("");
  console.log(`Inserting ${toInsert.length} rows…`);

  // Batch inserts so we don't hit URL/body caps on a single call.
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("time_off_requests").insert(chunk);
    if (error) {
      console.error(`Batch ${i}-${i + chunk.length} failed:`, error.message);
      console.error(`First row in failing batch:`, chunk[0]);
      process.exit(1);
    }
    inserted += chunk.length;
    console.log(`  ${inserted}/${toInsert.length}`);
  }
}
console.log("Done.");
