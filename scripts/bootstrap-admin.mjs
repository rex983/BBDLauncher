import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_NAME = process.env.ADMIN_NAME;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_EMAIL) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create auth user (satisfies the FK from profiles → auth.users).
// email_confirm: true so the user is active immediately; no password needed.
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: ADMIN_EMAIL,
  email_confirm: true,
  user_metadata: ADMIN_NAME ? { name: ADMIN_NAME } : undefined,
});

if (createError) {
  // If the user already exists, look them up instead.
  if (createError.message?.toLowerCase().includes("already")) {
    console.log("Auth user already exists; looking up...");
    const { data: list } = await supabase.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === ADMIN_EMAIL);
    if (!existing) {
      console.error("Could not find existing user.");
      process.exit(1);
    }
    await supabase.from("profiles").update({ role: "admin", name: ADMIN_NAME ?? null }).eq("id", existing.id);
    console.log(`Updated profile for ${ADMIN_EMAIL} (id=${existing.id}) to role=admin.`);
    process.exit(0);
  }
  console.error("createUser failed:", createError.message);
  process.exit(1);
}

const userId = created.user.id;
console.log(`Created auth user id=${userId}`);

// The handle_new_user trigger inserts a profile row. Give it a tick, then update.
const { data: profile, error: updateError } = await supabase
  .from("profiles")
  .update({ role: "admin", name: ADMIN_NAME ?? null })
  .eq("id", userId)
  .select()
  .single();

if (updateError) {
  console.error("Profile update failed:", updateError.message);
  process.exit(1);
}

console.log(`Done. Profile:`, profile);
