"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Copy, Download, Eye, EyeOff, Paperclip, Trash2 } from "lucide-react";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { fmtDay, fmtWhen } from "@/components/shared/format";
import { daysLeft, onboardingStatus, type OnboardingDetail } from "@/lib/onboarding/types";
import { ACCEPT_DOCS, uploadDocuments } from "./upload";

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export function OnboardingDetailShell({
  initial,
  isAdmin,
  isRequester,
}: {
  initial: OnboardingDetail;
  isAdmin: boolean;
  isRequester: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { viewAsUser } = useRolePreview();
  // View as shows the page as-is; only saving is blocked.
  const readOnly = !!viewAsUser;
  const [r, setR] = useState(initial);
  const [error, setError] = useState<string | null>(
    search.get("uploadFailed") ? "Some documents didn't upload. Add them again below." : null,
  );
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch(`/api/onboarding/${r.id}`, { cache: "no-store" });
    if (res.ok) setR(await res.json());
  };

  const patch = async (body: object) => {
    setError(null);
    const res = await fetch(`/api/onboarding/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(await readError(res, "Couldn't save"));
      return false;
    }
    setR(await res.json());
    return true;
  };

  const toggleTask = (taskId: string, done: boolean) => patch({ task_id: taskId, done });

  const remove = async () => {
    if (!confirm(`Delete the onboarding request for ${r.first_name} ${r.last_name} and its documents now?`)) return;
    setBusy(true);
    const res = await fetch(`/api/onboarding/${r.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError(await readError(res, "Couldn't delete"));
    router.push("/onboarding");
    router.refresh();
  };

  const status = onboardingStatus(r);
  const left = daysLeft(r.expires_at);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/onboarding" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Onboarding
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {r.first_name} {r.last_name}
            </h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Requested by {r.created_by_name || "a manager"} on {fmtWhen(r.created_at)} · deletes itself in{" "}
            {left === 1 ? "1 day" : `${left} days`}
          </p>
        </div>
        <Button variant="outline" onClick={remove} disabled={busy || readOnly}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete now
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New hire</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Field label="First name" value={r.first_name} />
            <Field label="Last name" value={r.last_name} />
            <Field label="Date of hire" value={fmtDay(r.hire_date)} />
            <Field label="Date of birth" value={fmtDay(r.dob)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {r.tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks.</p>}
          {r.tasks.map((t) => {
            const doneAt = t.done_at;
            return (
              <label key={t.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!doneAt}
                  disabled={!isAdmin || readOnly}
                  onChange={(e) => toggleTask(t.id, e.target.checked)}
                />
                <span className={doneAt ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                {doneAt && <span className="text-xs text-muted-foreground">{fmtWhen(doneAt)}</span>}
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Documents r={r} readOnly={readOnly} onChange={refresh} onError={setError} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && <SetLoginForm r={r} readOnly={readOnly} onSave={patch} />}
          {isRequester ? (
            <RevealLogin r={r} readOnly={readOnly} onRevealed={refresh} onError={setError} />
          ) : (
            !isAdmin && <p className="text-sm text-muted-foreground">Only the manager who asked can view the login.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Documents({
  r,
  readOnly,
  onChange,
  onError,
}: {
  r: OnboardingDetail;
  readOnly: boolean;
  onChange: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    onError(null);
    const failed = await uploadDocuments(r.id, files);
    setUploading(false);
    if (failed.length) onError(failed.join(" · "));
    await onChange();
  };

  const del = async (name: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    const res = await fetch(`/api/onboarding/${r.id}/documents/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) onError(await readError(res, "Couldn't delete"));
    await onChange();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Documents</CardTitle>
        <label
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
            readOnly || uploading ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-accent"
          }`}
        >
          <Paperclip className="h-4 w-4" />
          {uploading ? "Uploading…" : "Add files"}
          <input
            type="file"
            multiple
            accept={ACCEPT_DOCS}
            className="sr-only"
            disabled={readOnly || uploading}
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              add(picked);
            }}
          />
        </label>
      </CardHeader>
      <CardContent>
        {r.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents.</p>
        ) : (
          <ul className="divide-y text-sm">
            {r.documents.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate">{d.filename}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                    {d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : ""}
                  </span>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={`/api/onboarding/${r.id}/documents/${encodeURIComponent(d.name)}`} aria-label={`Download ${d.filename}`}>
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={readOnly}
                    onClick={() => del(d.name, d.filename)}
                    aria-label={`Delete ${d.filename}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Admin: enter the new hire's email + password. The password field has a
// show/hide toggle; once saved it's never shown back to the admin.
function SetLoginForm({
  r,
  readOnly,
  onSave,
}: {
  r: OnboardingDetail;
  readOnly: boolean;
  onSave: (body: object) => Promise<boolean>;
}) {
  const [email, setEmail] = useState(r.account_email ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(r.password_status === "none");

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">Email:</span> <span className="font-medium">{r.account_email}</span>
        </p>
        <p className="text-muted-foreground">
          {r.password_status === "waiting"
            ? `Password saved ${r.password_set_at ? fmtWhen(r.password_set_at) : ""} — waiting for ${r.created_by_name || "the manager"} to view it.`
            : `Viewed ${r.password_viewed_at ? fmtWhen(r.password_viewed_at) : ""} — the password has been deleted.`}
        </p>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={readOnly}>
          Enter a new password
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const ok = await onSave({ account_email: email, password });
        setSaving(false);
        if (ok) {
          setPassword("");
          setShow(false);
          setEditing(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ob-email">Email</Label>
          <Input id="ob-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-password">Password</Label>
          <div className="relative">
            <Input
              id="ob-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Stored encrypted until {r.created_by_name || "the manager"} views it once, then deleted.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || readOnly}>
          {saving ? "Saving…" : "Save login"}
        </Button>
        {r.password_status !== "none" && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// Requesting manager: one-time view. The password lives only in this
// component's state after the server deletes it.
function RevealLogin({
  r,
  readOnly,
  onRevealed,
  onError,
}: {
  r: OnboardingDetail;
  readOnly: boolean;
  onRevealed: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [login, setLogin] = useState<{ account_email: string | null; password: string } | null>(null);
  const [show, setShow] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    if (!confirm("You can see the password once. After this it's deleted for good. Show it now?")) return;
    setLoading(true);
    onError(null);
    const res = await fetch(`/api/onboarding/${r.id}/reveal`, { method: "POST", cache: "no-store" });
    setLoading(false);
    if (!res.ok) {
      onError(await readError(res, "Couldn't show the password"));
      await onRevealed();
      return;
    }
    setLogin(await res.json());
    await onRevealed();
  };

  if (login) {
    return (
      <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Email:</span> <span className="font-medium">{login.account_email}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Password:</span>
          <code className="rounded bg-muted px-2 py-0.5 font-mono">{show ? login.password : "••••••••••"}</code>
          <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy password"
            onClick={async () => {
              await navigator.clipboard.writeText(login.password).catch(() => undefined);
              setCopied(true);
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          {copied && <span className="text-xs text-muted-foreground">Copied</span>}
        </div>
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          This password has been deleted. Copy it now — it won&apos;t be shown again once you leave this page.
        </p>
      </div>
    );
  }

  if (r.password_status === "waiting") {
    return (
      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">Email:</span> <span className="font-medium">{r.account_email}</span>
        </p>
        <p className="text-muted-foreground">The password can be viewed once. After that it&apos;s deleted.</p>
        <Button onClick={reveal} disabled={loading || readOnly}>
          <Eye className="mr-2 h-4 w-4" />
          {loading ? "Loading…" : "Reveal password"}
        </Button>
      </div>
    );
  }

  if (r.password_status === "viewed") {
    return (
      <p className="text-sm text-muted-foreground">
        Email: <span className="font-medium text-foreground">{r.account_email}</span> · You viewed the password
        {r.password_viewed_at ? ` ${fmtWhen(r.password_viewed_at)}` : ""}. It has been deleted.
      </p>
    );
  }

  return <p className="text-sm text-muted-foreground">The login hasn&apos;t been entered yet. You&apos;ll get a notification when it is.</p>;
}
