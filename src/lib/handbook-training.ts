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
