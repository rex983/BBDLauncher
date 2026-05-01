import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const depositTierSchema = z.object({
  upTo: z.number().nullable(),
  percent: z.number(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().nullable().optional(),
  sign_now_template_id: z.string().optional(),
  deposit_percent: z.number().nullable().optional(),
  deposit_tiers: z.array(depositTierSchema).nullable().optional(),
  active: z.boolean().optional(),
});

function diff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
      changes.push({ field: k, oldValue: prev[k] ?? null, newValue: v });
    }
  }
  return changes;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: current } = await supabase
    .from("manufacturer_config")
    .select("*")
    .eq("id", id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }

  const { data, error } = await supabase
    .from("manufacturer_config")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const changes = diff(current, parsed.data);
  if (changes.length > 0) {
    await supabase.from("manufacturer_config_changelog").insert({
      config_id: id,
      config_name: data.name,
      action: "updated",
      changes,
      user_id: session.user.profileId,
      user_email: session.user.email,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: current } = await supabase
    .from("manufacturer_config")
    .select("*")
    .eq("id", id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase.from("manufacturer_config").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("manufacturer_config_changelog").insert({
    config_id: id,
    config_name: current.name,
    action: "deleted",
    changes: [
      { field: "name", oldValue: current.name, newValue: null },
      { field: "sku", oldValue: current.sku, newValue: null },
      { field: "sign_now_template_id", oldValue: current.sign_now_template_id, newValue: null },
      { field: "active", oldValue: current.active, newValue: null },
    ],
    user_id: session.user.profileId,
    user_email: session.user.email,
  });

  return NextResponse.json({ success: true });
}
