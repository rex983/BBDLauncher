import { createClient } from "@supabase/supabase-js";

function build() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
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
