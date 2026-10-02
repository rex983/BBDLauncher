import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { iconExtension } from "@/app/api/_lib/icon-types";

const MAX_BYTES = 1_000_000; // 1 MB

export async function POST(req: NextRequest) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  let file: File | null = null;
  try {
    const formData = await req.formData();
    const value = formData.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const ext = iconExtension(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type || "unknown"}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.round(MAX_BYTES / 1000)} KB)` },
      { status: 400 }
    );
  }

  const path = `${randomUUID()}.${ext}`;
  const supabase = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from("app-icons")
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from("app-icons").getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl, path });
}
