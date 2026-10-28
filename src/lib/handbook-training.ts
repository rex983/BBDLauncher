import { createAdminClient } from "@/lib/supabase/admin";

// In/out of training for the Employee Handbook (bbd-handbook). The handbook
// owns the tables (handbook_program, handbook_trainee in the shared DB); the
// launcher's user form is where people are put in or taken out of training.
// "In training" = the handbook releases the person's program one day at a
// time; "out of training" = nothing is locked. A person with no row is
// treated by the handbook as a new employee and put in training.

export interface TrainingProgram {
  id: string;
  name: string;
  is_default: boolean;
}

export interface TrainingStatus {
  inTraining: boolean;
  programId: string | null;
  startDate: string | null;
}

const TABLE_MISSING = new Set(["PGRST205", "42P01"]);

/** Today in Eastern time, YYYY-MM-DD. */
function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function listTrainingPrograms(): Promise<TrainingProgram[]> {
  const { data, error } = await createAdminClient()
    .from("handbook_program")
    .select("id, name, is_default")
    .order("name");
  if (error) {
    if (!TABLE_MISSING.has(error.code ?? "")) console.warn("[handbook-training] programs read failed", error.code);
    return [];
  }
  return (data ?? []) as TrainingProgram[];
}

/** null = no record yet (the handbook will treat them as new and put them in training). */
export async function readTraining(profileId: string): Promise<TrainingStatus | null> {
  const { data, error } = await createAdminClient()
    .from("handbook_trainee")
    .select("status, program_id, start_date")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error || !data) return null;
  return { inTraining: data.status === "in_training", programId: data.program_id, startDate: data.start_date };
}

/**
 * Put someone in training (in `programId`, or the default program) or take
 * them out. Day 1 is today when they go in, or when their program changes;
 * staying in the same program keeps their place.
 */
export async function setTraining(
  profileId: string,
  inTraining: boolean,
  programId: string | null,
  actorName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createAdminClient();
  const current = await readTraining(profileId);
  const now = new Date().toISOString();

  if (!inTraining) {
    if (current && !current.inTraining) return { ok: true };
    const { error } = await db.from("handbook_trainee").upsert(
      {
        profile_id: profileId,
        status: "graduated",
        program_id: current?.programId ?? null,
        start_date: current?.startDate ?? todayET(),
        graduated_at: now,
        graduated_by_name: actorName,
      },
      { onConflict: "profile_id" },
    );
    return error ? { ok: false, error: "Couldn't update training." } : { ok: true };
  }

  let program = programId;
  if (!program) {
    const { data: def } = await db.from("handbook_program").select("id").eq("is_default", true).maybeSingle();
    program = def?.id ?? null;
  }
  // Already in training in the same program: nothing to restart.
  if (current?.inTraining && current.programId === program) return { ok: true };

  const { error } = await db.from("handbook_trainee").upsert(
    {
      profile_id: profileId,
      status: "in_training",
      program_id: program,
      start_date: todayET(),
      manual_day: 0,
      last_notified_day: 0,
      enrolled_by_name: actorName,
      enrolled_at: now,
      graduated_at: null,
      graduated_by_name: null,
    },
    { onConflict: "profile_id" },
  );
  return error ? { ok: false, error: "Couldn't update training." } : { ok: true };
}

// ---------------------------------------------------------------------------
// Handbook editors: admins and senior/junior managers can always edit the
// handbook; anyone else needs a handbook_editor row, granted here by an admin.

/** Is this person granted editing (beyond their role)? */
export async function readHandbookEditor(profileId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("handbook_editor")
    .select("profile_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  return !error && !!data;
}

/** The handbook's launcher app (by its SSO audience). */
async function handbookAppId(): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("launcher_sso_configs")
    .select("app_id")
    .eq("jwt_audience", "bbd-handbook")
    .limit(1)
    .maybeSingle();
  return (data?.app_id as string | undefined) ?? null;
}

/**
 * Grant or remove editing. Granting also gives the person their own access
 * to the handbook tile (an editor who can't open it is no use). Removing
 * leaves that access alone, so a grant made on purpose isn't undone.
 * Returns whether tile access was added.
 */
export async function setHandbookEditor(
  profileId: string,
  allowed: boolean,
  actorName: string,
): Promise<{ ok: true; accessAdded: boolean } | { ok: false; error: string }> {
  const db = createAdminClient();
  if (!allowed) {
    const { error } = await db.from("handbook_editor").delete().eq("profile_id", profileId);
    return error ? { ok: false, error: "Couldn't update editing." } : { ok: true, accessAdded: false };
  }
  const { error } = await db
    .from("handbook_editor")
    .upsert({ profile_id: profileId, granted_by_name: actorName }, { onConflict: "profile_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: "Couldn't update editing." };

  const appId = await handbookAppId();
  if (!appId) return { ok: true, accessAdded: false };
  const { data: canOpen } = await db.rpc("launcher_can_open_app", { p_profile_id: profileId, p_audience: "bbd-handbook" });
  if (canOpen === true) return { ok: true, accessAdded: false };
  const { error: accessErr } = await db.from("launcher_user_access").insert({ profile_id: profileId, app_id: appId });
  if (accessErr && accessErr.code !== "23505") return { ok: false, error: "Editing granted, but couldn't open the handbook tile for them." };
  return { ok: true, accessAdded: true };
}
