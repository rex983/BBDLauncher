import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData, isAdmin, timeDataScope } from "@/lib/auth/permissions";
import { generateText, getActiveProvider, AIProviderError } from "@/lib/ai";
import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_DRAFT_SYSTEM_PROMPT,
  INCIDENT_SEVERITY_LABEL,
} from "@/lib/incidents/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  employee_profile_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum([
    "attendance",
    "performance",
    "conduct",
    "safety",
    "policy",
    "other",
  ]),
  occurred_at: z.string().datetime().nullable().optional(),
  description: z.string().min(10).max(10_000),
});

// POST /api/management/incidents/generate — run the configured LLM against
// the manager's description and return the drafted report body. Does not
// persist anything; the client re-submits (with any edits) to POST
// /api/management/incidents to actually create the row.
//
// Kept as a separate endpoint from create so the UI can "regenerate" without
// creating a bunch of orphan draft rows.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Scope check + fetch the employee's display name to feed the AI prompt.
  const { data: target } = await supabase
    .from("profiles")
    .select("full_name, department, office, is_active")
    .eq("id", parsed.data.employee_profile_id)
    .single<{
      full_name: string | null;
      department: string | null;
      office: string | null;
      is_active: boolean;
    }>();
  if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  if (!isAdmin(session.user.role)) {
    const scope = timeDataScope(
      session.user.role,
      session.user.department,
      session.user.office,
    );
    if (!scope.allowed) {
      return NextResponse.json({ error: "No scope" }, { status: 403 });
    }
    if (target.is_active === false) {
      return NextResponse.json({ error: "Employee is inactive" }, { status: 403 });
    }
    if (scope.department && target.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && target.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const occurredLine = parsed.data.occurred_at
    ? new Date(parsed.data.occurred_at).toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : "(not specified)";

  const userPrompt = [
    `Employee name: ${target.full_name || "the employee"}`,
    `Report title: ${parsed.data.title}`,
    `Category: ${INCIDENT_CATEGORY_LABEL[parsed.data.category]}`,
    `Severity: ${INCIDENT_SEVERITY_LABEL[parsed.data.severity]}`,
    `Date of incident: ${occurredLine}`,
    "",
    "Manager's description of what happened:",
    parsed.data.description,
    "",
    "Draft the incident report body now following the format in the system prompt.",
  ].join("\n");

  try {
    const provider = getActiveProvider();
    const result = await generateText({
      system: INCIDENT_DRAFT_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
      maxTokens: 1500,
    });
    return NextResponse.json({
      document: result.text,
      provider: result.provider,
      model: result.model,
      // Echo back the exact prompt sent — persisted on the row for audit
      // when the manager clicks "Save" so the create endpoint doesn't have
      // to reconstruct it.
      prompt: userPrompt,
      configuredProvider: provider,
    });
  } catch (err) {
    if (err instanceof AIProviderError) {
      return NextResponse.json(
        { error: err.message, provider: err.provider },
        { status: err.status && err.status >= 400 && err.status < 500 ? 502 : 500 },
      );
    }
    console.error("[incidents/generate] unexpected error:", err);
    return NextResponse.json({ error: "AI provider error" }, { status: 500 });
  }
}
