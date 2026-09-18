import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAiConfig,
  getProviderAvailability,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
} from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET /api/admin/ai-settings — current active provider + model, when it was
// last changed and by whom, and which providers have API keys wired up. Used
// by /admin/ai to render the settings UI.
export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("ai_config")
    .select("provider, model, updated_at, updated_by")
    .eq("id", 1)
    .single<{
      provider: SupportedProvider;
      model: string | null;
      updated_at: string;
      updated_by: string | null;
    }>();

  // Resolve the on-disk env fallback too so the UI can show "env would use
  // X if the DB row were deleted" alongside the active value.
  const envConfig = await getEnvSnapshot();

  let updatedByProfile: { name: string | null; email: string } | null = null;
  if (row?.updated_by) {
    const { data } = await supabase
      .from("profiles")
      .select("name:full_name, email")
      .eq("id", row.updated_by)
      .single<{ name: string | null; email: string }>();
    updatedByProfile = data ?? null;
  }

  return NextResponse.json({
    active: {
      provider: row?.provider ?? envConfig.provider,
      model: row?.model ?? envConfig.model,
    },
    env: envConfig,
    availability: getProviderAvailability(),
    supported: SUPPORTED_PROVIDERS,
    updated_at: row?.updated_at ?? null,
    updated_by: updatedByProfile,
  });
}

const patchSchema = z.object({
  provider: z.enum(["gemini", "anthropic", "openai"]),
  model: z.string().trim().max(128).nullable().optional(),
});

// PATCH updates the singleton config row. Only admins. Model is optional —
// null means "let the provider decide" (uses the per-provider default).
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ai_config")
    .upsert(
      {
        id: 1,
        provider: parsed.data.provider,
        model: parsed.data.model?.trim() || null,
        updated_by: session.user.profileId,
      },
      { onConflict: "id" },
    )
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// Reuse getAiConfig but force it to skip the DB (call the env path directly)
// so the UI can display the env fallback alongside the current DB value.
async function getEnvSnapshot(): Promise<{
  provider: SupportedProvider;
  model: string | null;
}> {
  // Temporarily route around the DB — read env only. getAiConfig itself
  // reads DB first, so we do the env decode inline to match its rules.
  const raw = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const provider: SupportedProvider =
    raw === "anthropic" || raw === "openai" ? raw : "gemini";
  return { provider, model: process.env.AI_MODEL || null };
}

// Keep this import used to prove parity with the runtime lookup path.
void getAiConfig;
