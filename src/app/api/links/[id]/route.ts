import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/validation";
import { z } from "zod";
import { httpUrl } from "@/lib/launcher/app-schema";
import { isKnownOffice } from "@/lib/org/lists";
import { setUserIds } from "@/lib/launcher/user-access";

const linkUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  url: httpUrl.optional(),
  icon_url: z.string().nullable().optional(),
  display_order: z.number().optional(),
  /** An office from launcher_offices (migration 051); null = every office. */
  office: z.string().min(1).nullable().optional(),
  /** Shown only to the people in user_ids. */
  people_only: z.boolean().optional(),
  /** Individual people who see the link, on top of the office filter. */
  user_ids: z.array(z.string().uuid()).max(500).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(canManageContent);
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const body = await req.json();
    const parsed = linkUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    const { user_ids, ...linkData } = parsed.data;
    if (!(await isKnownOffice(linkData.office))) {
      return NextResponse.json({ error: "Unknown office" }, { status: 400 });
    }
    const supabase = createAdminClient();

    const { data: link, error } = await supabase
      .from("launcher_links")
      .update(linkData)
      .eq("id", id)
      .select()
      .single();

    if (error || !link) {
      return NextResponse.json(
        { error: error?.message || "Failed to update" },
        { status: 500 }
      );
    }

    if (user_ids !== undefined) {
      const userError = await setUserIds("link_id", id, user_ids);
      if (userError) return NextResponse.json({ error: userError }, { status: 500 });
    }

    bustLauncherCache("links");
    return NextResponse.json(link);
  } catch (err) {
    console.error("PUT /api/links error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(canManageContent);
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("launcher_links")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    bustLauncherCache("links");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/links error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
