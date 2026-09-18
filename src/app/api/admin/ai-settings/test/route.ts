import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { AIProviderError, generateText, type SupportedProvider } from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  provider: z.enum(["gemini", "anthropic", "openai"]),
  model: z.string().trim().max(128).nullable().optional(),
});

// POST /api/admin/ai-settings/test — dry-run a tiny generation against the
// given provider + model so the admin can verify the key and model name
// without persisting a config change. Response is trimmed to the reply text
// so we don't leak the API's raw payload back to the client.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const started = Date.now();
  try {
    const res = await generateText({
      provider: parsed.data.provider as SupportedProvider,
      model: parsed.data.model?.trim() || undefined,
      system:
        "You are a health-check probe. Reply with a single short sentence confirming you received the message.",
      prompt: "Say a brief hello and confirm you can respond.",
      temperature: 0.2,
      maxTokens: 60,
    });
    return NextResponse.json({
      ok: true,
      provider: res.provider,
      model: res.model,
      text: res.text,
      latency_ms: Date.now() - started,
    });
  } catch (err) {
    if (err instanceof AIProviderError) {
      return NextResponse.json(
        {
          ok: false,
          provider: err.provider,
          status: err.status ?? null,
          error: err.message,
          latency_ms: Date.now() - started,
        },
        { status: 200 }, // 200 so the client can render the failure inline
      );
    }
    console.error("[ai-settings/test] unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error running test" },
      { status: 500 },
    );
  }
}
