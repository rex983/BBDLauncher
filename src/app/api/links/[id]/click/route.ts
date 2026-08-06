import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const { id } = await params;
    const supabase = createAdminClient();

    const { data: link } = await supabase
      .from("launcher_links")
      .select("id, name, url")
      .eq("id", id)
      .single();

    if (!link) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const safeUrl = /^https?:\/\//i.test(link.url) ? link.url : null;
    if (!safeUrl) {
      return NextResponse.json({ error: "Link has an invalid URL" }, { status: 500 });
    }

    const { error: auditErr } = await supabase.from("launcher_sso_audit_log").insert({
      user_id: session.user.profileId,
      link_id: id,
      event_type: "link_click",
      details: { link_name: link.name },
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
      user_agent: req.headers.get("user-agent"),
    });
    if (auditErr) {
      console.error("Link audit log insert failed:", {
        code: auditErr.code,
        message: auditErr.message,
        details: auditErr.details,
        user_id: session.user.profileId,
        link_id: id,
      });
    }

    return NextResponse.redirect(safeUrl);
  } catch (err) {
    console.error("Link click error:", err);
    return NextResponse.json({ error: "Click failed" }, { status: 500 });
  }
}
