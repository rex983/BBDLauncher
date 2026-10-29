import { createClient } from "@supabase/supabase-js";
import { auditFetch } from "../../../kit/launcher-kit/audit";

function build() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // Tags writes with who made them (edit/audit log, launcher migration 060).
      global: { fetch: auditFetch("BBD Launcher") },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Service-role client, built once per server instance. It never holds a user
// session (persistSession/autoRefreshToken off, and nothing calls .auth on
// it), so sharing it across requests is safe and skips rebuilding the
// auth/realtime/storage sub-clients on every call.
let client: ReturnType<typeof build> | null = null;

export function createAdminClient() {
  return (client ??= build());
}
