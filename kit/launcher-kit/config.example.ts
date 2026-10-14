// The one per-app file in src/lib/launcher-kit/. kit/sync.mjs never touches
// it: copy this to config.ts in a new app and fill it in.

import { createAdminClient } from "@/lib/supabase/admin";

/** This app's jwt_audience in launcher_sso_configs. */
export const APP_AUDIENCE = "my-app";

/** Shown in sign-in errors ("You don't have access to <APP_NAME> …"). */
export const APP_NAME = "My App";

/** Service-role Supabase client (shared BBD database). */
export const adminClient = createAdminClient;
