import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OFFICES } from "@/lib/org/constants";

const linkSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  url: z.string().url(),
  icon_url: z.string().nullable().optional(),
  display_order: z.number().default(0),
  office: z.enum(OFFICES).nullable().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const supabase = createAdminClient();
    const { data: links, error } = await supabase
      .from("launcher_links")
      .select("*")
      .order("display_order", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(links || []);
  } catch (err) {
    console.error("GET /api/links error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(canManageContent);
    if (session instanceof NextResponse) return session;

    const body = await req.json();
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: link, error } = await supabase
      .from("launcher_links")
      .insert(parsed.data)
      .select()
      .single();

    if (error || !link) {
      return NextResponse.json(
        { error: error?.message || "Failed to create link" },
        { status: 500 }
      );
    }

    bustLauncherCache("links");
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    console.error("POST /api/links error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
