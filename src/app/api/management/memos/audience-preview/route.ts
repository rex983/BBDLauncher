import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData, isAdmin } from "@/lib/auth/permissions";
import { resolveMemoAudience } from "@/lib/memos/audience";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const previewSchema = z.object({
  audience_scope: z.enum(["company", "office", "department", "custom"]),
  audience_office: z.string().nullable().optional(),
  audience_department: z.string().nullable().optional(),
  custom_profile_ids: z.array(z.string().uuid()).max(500).optional(),
});

// POST /api/management/memos/audience-preview — resolve the recipient
// list for a proposed audience scope + filter combination, so the
// compose UI can show the count and (for smaller lists) the names before
// the author publishes. Enforces the same scope restrictions as the
// create endpoint.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const parsed = previewSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = isAdmin(session.user.role);
  if (!admin) {
    if (parsed.data.audience_scope === "company") {
      return NextResponse.json(
        { error: "Only admins can preview company-wide audiences." },
        { status: 403 },
      );
    }
    if (
      parsed.data.audience_scope === "office" &&
      parsed.data.audience_office !== session.user.office
    ) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (
      parsed.data.audience_scope === "department" &&
      parsed.data.audience_department !== session.user.department
    ) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const supabase = createAdminClient();
  const { profileIds, audienceLabel } = await resolveMemoAudience({
    supabase,
    scope: parsed.data.audience_scope,
    office: parsed.data.audience_office ?? null,
    department: parsed.data.audience_department ?? null,
    customProfileIds: parsed.data.custom_profile_ids ?? [],
  });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, office, department")
    .in("id", profileIds.length > 0 ? profileIds : ["00000000-0000-0000-0000-000000000000"]);

  return NextResponse.json({
    count: profileIds.length,
    audience_label: audienceLabel,
    recipients: profiles || [],
  });
}
