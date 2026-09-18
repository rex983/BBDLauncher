"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Save, Sparkles, TriangleAlert, XCircle } from "lucide-react";
import { isAdmin } from "@/lib/auth/permissions";

type Provider = "gemini" | "anthropic" | "openai";

interface Settings {
  active: { provider: Provider; model: string | null };
  env: { provider: Provider; model: string | null };
  availability: Record<Provider, boolean>;
  supported: Provider[];
  updated_at: string | null;
  updated_by: { name: string | null; email: string } | null;
}

interface TestResult {
  ok: boolean;
  provider?: Provider;
  model?: string;
  text?: string;
  status?: number | null;
  error?: string;
  latency_ms?: number;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
};

// Suggestion set surfaced under the model input. These are Google-published
// stable aliases + the current-tier best models. Users can type anything —
// the abstraction hands the model name straight through to each provider.
const MODEL_HINTS: Record<Provider, string[]> = {
  gemini: [
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-pro",
  ],
  anthropic: [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
  ],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
};

const ENV_VAR_LABEL: Record<Provider, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export default function AiSettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Client-side admin gate. Server route also enforces this — belt + braces.
  useEffect(() => {
    if (sessionStatus !== "loading" && !isAdmin(session?.user?.role)) {
      redirect("/dashboard");
    }
  }, [session, sessionStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/ai-settings", { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to load settings");
      setLoading(false);
      return;
    }
    const body: Settings = await res.json();
    setSettings(body);
    setProvider(body.active.provider);
    setModel(body.active.model ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    settings !== null &&
    (settings.active.provider !== provider ||
      (settings.active.model ?? "") !== model.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/ai-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: model.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Save failed");
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    await load();
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/admin/ai-settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: model.trim() || null,
      }),
    });
    setTesting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setTestResult({
        ok: false,
        error: typeof b.error === "string" ? b.error : "Test failed",
      });
      return;
    }
    setTestResult(await res.json());
  };

  const modelSuggestions = MODEL_HINTS[provider];
  const hasKey = settings?.availability[provider] ?? false;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">AI Settings</h1>
        <p className="text-muted-foreground">
          Pick which LLM the launcher uses for incident-report drafting.
          Changes take effect immediately — no redeploy.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !settings ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Currently in use
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge>{PROVIDER_LABELS[settings.active.provider]}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {settings.active.model || "(provider default)"}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Env fallback
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {PROVIDER_LABELS[settings.env.provider]} ·{" "}
                    {settings.env.model || "provider default"}
                  </div>
                </div>
              </div>
              {settings.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Last changed {new Date(settings.updated_at).toLocaleString()}
                  {settings.updated_by
                    ? ` by ${settings.updated_by.name || settings.updated_by.email}`
                    : ""}
                  .
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prov">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as Provider);
                // Blank the model input so the placeholder for the new
                // provider shows and picks its default.
                setModel("");
                setTestResult(null);
              }}
            >
              <SelectTrigger id="prov">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(settings?.supported ?? []).map((p) => {
                  const ok = settings?.availability[p];
                  return (
                    <SelectItem key={p} value={p}>
                      <span className="flex items-center gap-2">
                        {PROVIDER_LABELS[p]}
                        {ok ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <TriangleAlert className="h-3 w-3 text-amber-500" />
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {settings && !hasKey && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No {ENV_VAR_LABEL[provider]} configured in Vercel. Add it and
                redeploy before switching, or generation will fail.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={model}
              placeholder={`Leave blank for provider default (${modelSuggestions[0]})`}
              onChange={(e) => setModel(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {modelSuggestions.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={save} disabled={saving || !dirty}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={runTest} disabled={testing || !hasKey}>
              <Sparkles className="mr-2 h-4 w-4" />
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {savedFlash && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                Saved — new provider is live.
              </span>
            )}
          </div>

          {testResult && (
            <div
              className={`rounded-md border p-3 text-sm ${
                testResult.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-destructive/50 bg-destructive/10"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Success</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span>Failed</span>
                  </>
                )}
                {typeof testResult.latency_ms === "number" && (
                  <span className="text-xs text-muted-foreground">
                    {testResult.latency_ms} ms
                  </span>
                )}
              </div>
              {testResult.ok ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {testResult.provider} · {testResult.model}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{testResult.text}</p>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {testResult.error}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider status</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(settings?.supported ?? []).map((p) => {
              const ok = settings?.availability[p];
              return (
                <li key={p} className="flex items-center gap-2">
                  {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium">{PROVIDER_LABELS[p]}</span>
                  <span className="text-muted-foreground">
                    {ok
                      ? `${ENV_VAR_LABEL[p]} configured`
                      : `${ENV_VAR_LABEL[p]} not set — add it in Vercel to enable`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            API keys stay in Vercel environment variables — this page only
            selects which one to use.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
