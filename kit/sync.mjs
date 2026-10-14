#!/usr/bin/env node
// Copies kit/launcher-kit into every BBD app's src/lib/launcher-kit/ so the
// launcher integration is the same code everywhere.
//
//   node kit/sync.mjs           copy into every app that's checked out next to this repo
//   node kit/sync.mjs --check   report apps whose copy differs (exit 1), change nothing
//
// config.ts is per-app and never touched (see config.example.ts).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPS = [
  "asc-engineering",
  "bbd-helpdesk",
  "bbd-manufacturer-hub",
  "bbd-mbox-archive",
  "bbd-pm",
  "manufacturer-questions",
  "psb-pricing",
  "qsb-pricing",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "launcher-kit");
const reposRoot = path.resolve(here, "..", "..");
const check = process.argv.includes("--check");

const HEADER = (file) =>
  `// Synced from BBDLauncher/kit/launcher-kit/${file} — don't edit here.\n` +
  `// Change it in the launcher repo and run \`node kit/sync.mjs\`.\n\n`;

const files = fs
  .readdirSync(src)
  .filter((f) => /\.(ts|tsx)$/.test(f) && f !== "config.example.ts")
  .sort();

/** Header after any "use client" directive, which must stay first. */
function render(file) {
  const body = fs.readFileSync(path.join(src, file), "utf8").replace(/\r\n/g, "\n");
  const directive = body.match(/^("use client";\n\n?)/);
  return directive
    ? directive[1] + HEADER(file) + body.slice(directive[1].length)
    : HEADER(file) + body;
}

let drift = 0;
for (const app of APPS) {
  const appRoot = path.join(reposRoot, app);
  if (!fs.existsSync(appRoot)) {
    console.log(`- ${app}: not checked out, skipped`);
    continue;
  }
  const dest = path.join(appRoot, "src", "lib", "launcher-kit");
  const problems = [];

  if (!fs.existsSync(path.join(dest, "config.ts"))) problems.push("config.ts missing");
  for (const file of files) {
    const want = render(file);
    const target = path.join(dest, file);
    const have = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
    if (have === want) continue;
    if (check) problems.push(have === null ? `${file} missing` : `${file} differs`);
    else {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(target, want);
      problems.push(`${file} updated`);
    }
  }
  const extra = fs.existsSync(dest)
    ? fs.readdirSync(dest).filter((f) => f !== "config.ts" && !files.includes(f))
    : [];
  for (const f of extra) problems.push(`${f} is not part of the kit`);

  if (check && problems.some((p) => !p.endsWith("updated"))) drift++;
  console.log(`${problems.length ? "•" : "✓"} ${app}${problems.length ? ": " + problems.join(", ") : ""}`);
}

if (check && drift) {
  console.error(`\n${drift} app(s) out of sync. Run: node kit/sync.mjs`);
  process.exit(1);
}
