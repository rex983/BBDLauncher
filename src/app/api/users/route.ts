import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["admin", "manager", "sales_rep", "bst", "rnd"]).default("sales_rep"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, name, role, created_at, updated_at")
    .order("email");

  return NextResponse.json(users || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, name, role } = parsed.data;
  const supabase = createAdminClient();

  // Create the auth user — email-confirmed so Google sign-in on first login
  // links to this account. No password; users authenticate via Google OAuth.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: name ? { name } : undefined,
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message || "Failed to create user" },
      { status: 500 }
    );
  }

  // The handle_new_user trigger inserts a profile row; update name + role on it.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .update({ name: name ?? null, role })
    .eq("id", created.user.id)
    .select()
    .single();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json(profile, { status: 201 });
}
