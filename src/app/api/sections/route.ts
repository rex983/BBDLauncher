import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const sectionSchema = z.object({
  name: z.string().min(1).max(100),
  display_order: z.number().int().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("launcher_sections")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = sectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  // If display_order not provided, append to end.
  let displayOrder = parsed.data.display_order;
  if (displayOrder === undefined) {
    const { data: last } = await supabase
      .from("launcher_sections")
      .select("display_order")
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    displayOrder = (last?.display_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("launcher_sections")
    .insert({ name: parsed.data.name, display_order: displayOrder })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

// Bulk reorder: PUT with { orders: [{id, display_order}, ...] }
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const schema = z.object({
    orders: z.array(z.object({ id: z.string().uuid(), display_order: z.number().int() })),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  for (const { id, display_order } of parsed.data.orders) {
    const { error } = await supabase
      .from("launcher_sections")
      .update({ display_order })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ success: true });
}
