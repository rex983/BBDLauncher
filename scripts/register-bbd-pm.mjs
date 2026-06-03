// One-off: register BBD R&D PM as a JWT-SSO app in the launcher.
// Run from BBDLauncher dir:  node scripts/register-bbd-pm.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = "./.env.production.tmp";
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const [k, ...rest] = l.split("=");
        return [k.trim(), rest.join("=").replace(/^"|"$/g, "")];
      }),
  );
} catch {}

const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
let key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Launcher's pulled env marks the service-role key sensitive (empty).
// Borrow from asc-engineering, which keeps a current copy.
if (!key) {
  try {
    const ascEnv = readFileSync(
      "C:/Users/Redir/asc-engineering/.env.production.tmp",
      "utf8",
    );
    const m = ascEnv.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (m) key = m[1].replace(/^"|"$/g, "");
  } catch {}
}

if (!url || !key) {
  console.error("Missing Supabase URL or service-role key");
  process.exit(1);
}

const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APP_NAME = "R&D Project Manager";
const APP_URL = "https://bbd-pm.vercel.app";
const ACS_URL = `${APP_URL}/sso/callback`;
const AUDIENCE = "bbd-pm";
const DESCRIPTION =
  "Internal project tracker for the BBD R&D team: projects, tasks, notes, and links.";

// 1. Pick a section.
const { data: sections } = await supa
  .from("launcher_sections")
  .select("id, name, display_order")
  .order("display_order", { ascending: true });
console.log(
  "sections:",
  sections?.map((s) => `${s.name} (${s.display_order})`).join(", "),
);
const defaultSection =
  sections?.find((s) => /tool|app|internal|admin/i.test(s.name)) ||
  sections?.[0] ||
  null;

// 2. Upsert app.
const { data: existingApp } = await supa
  .from("launcher_apps")
  .select("id")
  .eq("name", APP_NAME)
  .maybeSingle();

let appId;
if (existingApp) {
  const { error } = await supa
    .from("launcher_apps")
    .update({
      url: APP_URL,
      sso_type: "jwt",
      status: "active",
      open_in_new_tab: true,
      description: DESCRIPTION,
      section_id: defaultSection?.id ?? null,
    })
    .eq("id", existingApp.id);
  if (error) throw error;
  appId = existingApp.id;
  console.log("app updated:", appId);
} else {
  const { data, error } = await supa
    .from("launcher_apps")
    .insert({
      name: APP_NAME,
      description: DESCRIPTION,
      url: APP_URL,
      sso_type: "jwt",
      status: "active",
      display_order: 999,
      open_in_new_tab: true,
      section_id: defaultSection?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  appId = data.id;
  console.log("app created:", appId);
}

// 3. SSO config.
const { data: existingSso } = await supa
  .from("launcher_sso_configs")
  .select("id")
  .eq("app_id", appId)
  .maybeSingle();

if (existingSso) {
  const { error } = await supa
    .from("launcher_sso_configs")
    .update({ jwt_acs_url: ACS_URL, jwt_audience: AUDIENCE })
    .eq("id", existingSso.id);
  if (error) throw error;
  console.log("sso config updated");
} else {
  const { error } = await supa.from("launcher_sso_configs").insert({
    app_id: appId,
    jwt_acs_url: ACS_URL,
    jwt_audience: AUDIENCE,
  });
  if (error) throw error;
  console.log("sso config created");
}

// 4. Role grants — full R&D team gets in.
const ROLES = ["admin", "manager", "sales_rep"];
for (const role of ROLES) {
  const { error } = await supa
    .from("launcher_role_app_access")
    .upsert({ role_name: role, app_id: appId }, { onConflict: "role_name,app_id" });
  if (error) console.error(`role ${role} grant failed:`, error.message);
  else console.log(`role ${role} granted`);
}

console.log("\nApp ID:", appId);
console.log("Launch URL: /api/launch/" + appId);
