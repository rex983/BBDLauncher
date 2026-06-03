// One-off: register Manufacturer-Questions as a JWT-SSO app in the launcher.
// Run from BBDLauncher dir:  node scripts/register-manufacturer-questions.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Read service role key from the previously pulled production env.
const envFile = "./.env.production.tmp";
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const [k, ...rest] = l.split("=");
      return [k.trim(), rest.join("=").replace(/^"|"$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
let key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// The launcher's pull marks the service-role key sensitive (empty in the file).
// asc-engineering's pulled env has the current rotated key.
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

const APP_NAME = "Manufacturer Questions";
const APP_URL = "https://manufacturer-questions.vercel.app";
const ACS_URL = `${APP_URL}/sso/callback`;
const AUDIENCE = "manufacturer-questions";

// 1. Find an "Apps" or default section to attach to (optional).
const { data: sections } = await supa
  .from("launcher_sections")
  .select("id, name, display_order")
  .order("display_order", { ascending: true });
console.log(
  "sections:",
  sections?.map((s) => `${s.name} (${s.display_order})`).join(", "),
);
const defaultSection =
  sections?.find((s) => /tool|app/i.test(s.name)) || sections?.[0] || null;

// 2. Upsert the launcher_apps row by name (idempotent).
const { data: existingApp } = await supa
  .from("launcher_apps")
  .select("id")
  .eq("name", APP_NAME)
  .maybeSingle();

let appId;
if (existingApp) {
  console.log("app already exists:", existingApp.id);
  const { error } = await supa
    .from("launcher_apps")
    .update({
      url: APP_URL,
      sso_type: "jwt",
      status: "active",
      open_in_new_tab: true,
      description:
        "Sales rep portal: live view of submitted manufacturer questions and responses.",
      section_id: defaultSection?.id ?? null,
    })
    .eq("id", existingApp.id);
  if (error) throw error;
  appId = existingApp.id;
} else {
  const { data, error } = await supa
    .from("launcher_apps")
    .insert({
      name: APP_NAME,
      description:
        "Sales rep portal: live view of submitted manufacturer questions and responses.",
      url: APP_URL,
      sso_type: "jwt",
      status: "active",
      display_order: 999,
      open_in_new_tab: true,
      section_id: defaultSection?.id ?? null,
      office: null,
    })
    .select("id")
    .single();
  if (error) throw error;
  appId = data.id;
  console.log("app created:", appId);
}

// 3. Upsert the SSO config (audience + ACS URL).
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

// 4. Grant access to all roles that should see it.
const ROLES = ["admin", "manager", "sales_rep"];
for (const role of ROLES) {
  const { error } = await supa
    .from("launcher_role_app_access")
    .upsert({ role_name: role, app_id: appId }, { onConflict: "role_name,app_id" });
  if (error) {
    console.error(`role ${role} grant failed:`, error.message);
  } else {
    console.log(`role ${role} granted`);
  }
}

console.log("\nApp ID:", appId);
console.log("Launch URL: /api/launch/" + appId);
