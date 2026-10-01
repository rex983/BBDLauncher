// One-click actions the launcher can perform itself during offboarding.
// Both are idempotent: re-running deactivate is a no-op beyond another
// session bump, and each export writes a new timestamped file.

import { createAdminClient } from "@/lib/supabase/admin";
import { isClockedIn } from "@/lib/timesheets/server";
import { EXPORT_BUCKET } from "./service";

// Same effect as unticking "Active" in /admin/users (is_active=false +
// session_version bump + signed_out_at) so the launcher and every
// JWT-SSO app eject them on their next request. Also closes any open
// shift so their timesheet doesn't run on forever.
export async function deactivateLauncherAccount(
  profileId: string,
): Promise<{ ok: true; clockedOut: boolean } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("profiles")
    .select("session_version")
    .eq("id", profileId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Employee profile no longer exists" };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({
      is_active: false,
      session_version: ((before.session_version as number | null) ?? 1) + 1,
      signed_out_at: now,
    })
    .eq("id", profileId);
  if (error) return { ok: false, error: error.message };

  let clockedOut = false;
  if (await isClockedIn(profileId)) {
    const { error: punchErr } = await supabase.from("time_punches").insert({
      profile_id: profileId,
      event_type: "clock_out",
      occurred_at: now,
      source: "auto",
      note: "Clocked out by offboarding",
    });
    clockedOut = !punchErr;
  }
  return { ok: true, clockedOut };
}

// Every launcher table keyed to the person. Each query is independent; a
// failing one is recorded in the file rather than aborting the backup.
const EXPORT_SOURCES: Array<{ key: string; table: string; column: string; select?: string }> = [
  { key: "time_punches", table: "time_punches", column: "profile_id" },
  { key: "work_schedules", table: "work_schedules", column: "profile_id" },
  { key: "time_extensions", table: "time_extensions", column: "profile_id" },
  { key: "time_off_requests", table: "time_off_requests", column: "profile_id" },
  { key: "incident_reports", table: "incident_reports", column: "employee_profile_id" },
  {
    key: "memo_receipts",
    table: "office_memo_recipients",
    column: "profile_id",
    select: "*, memo:office_memos(number, title, category, published_at)",
  },
  { key: "app_launch_history", table: "launcher_sso_audit_log", column: "user_id" },
  { key: "notifications", table: "notifications", column: "user_id" },
];

export async function exportLauncherData(params: {
  caseId: string;
  profileId: string;
  exportedBy: string;
}): Promise<{ ok: true; path: string; counts: Record<string, number> } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", params.profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Employee profile no longer exists" };

  const results = await Promise.all(
    EXPORT_SOURCES.map(async (s) => {
      const { data, error } = await supabase
        .from(s.table)
        .select(s.select ?? "*")
        .eq(s.column, params.profileId);
      return [s.key, error ? { error: error.message } : (data ?? [])] as const;
    }),
  );

  const counts: Record<string, number> = {};
  for (const [key, value] of results) counts[key] = Array.isArray(value) ? value.length : 0;

  const generatedAt = new Date();
  const file = {
    generated_at: generatedAt.toISOString(),
    generated_by: params.exportedBy,
    offboarding_case_id: params.caseId,
    profile,
    ...Object.fromEntries(results),
  };

  const stamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  const path = `${params.caseId}/${stamp}-launcher-records.json`;
  const { error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(path, JSON.stringify(file, null, 2), { contentType: "application/json" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path, counts };
}
