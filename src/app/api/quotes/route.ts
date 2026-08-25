import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateNewQuote } from "@/lib/quotes/refresh";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  quote: z.string().min(3).max(400),
  author: z.string().min(1).max(120),
  activate: z.boolean().optional(),
});

// List all quotes (newest first). Admin only.
export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("launcher_motivational_quotes")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

// Create a manual quote. If activate=true, also mark it as the active quote.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (parsed.data.activate) {
    try {
      const row = await activateNewQuote(supabase, {
        quote: parsed.data.quote,
        author: parsed.data.author,
        source: "manual",
        created_by: session.user.email ?? null,
      });
      return NextResponse.json(row, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to create" },
        { status: 500 }
      );
    }
  }

  const { data, error } = await supabase
    .from("launcher_motivational_quotes")
    .insert({
      quote: parsed.data.quote,
      author: parsed.data.author,
      source: "manual",
      is_active: false,
      created_by: session.user.email ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to create" },
      { status: 500 }
    );
  }
  return NextResponse.json(data, { status: 201 });
}
