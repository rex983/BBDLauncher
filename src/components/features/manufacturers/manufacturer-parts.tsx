"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDateTimeUS, fmtDateUS, fmtRelative } from "@/components/shared/format";
import { PersonLink } from "@/components/features/people/person-peek";
import { avatarColor, initials } from "../../../../kit/launcher-kit/launcher-avatar";
import type { DepositTier, ManufacturerChange, ManufacturerConfig } from "@/types/manufacturer";

// Pieces shared by the Manufacturers list, the card behind each row and the
// full manufacturer page.

/** The hub's logo when it has one, otherwise coloured initials. */
export function ManufacturerLogo({
  id,
  name,
  logoUrl,
  size = 36,
  className = "",
}: {
  id: string;
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (logoUrl && failed !== logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote hub logo, already sized
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(logoUrl)}
        className={`inline-block shrink-0 rounded-md border bg-white object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), backgroundColor: avatarColor(id) }}
    >
      {initials(name)}
    </span>
  );
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "18%", "3 tiers", or "—" — read-only; deposits come from Strapi. */
export function depositSummary(m: Pick<ManufacturerConfig, "deposit_percent" | "deposit_tiers">): string {
  if (m.deposit_tiers && m.deposit_tiers.length > 0) {
    return `${m.deposit_tiers.length} tier${m.deposit_tiers.length === 1 ? "" : "s"}`;
  }
  return m.deposit_percent != null ? `${m.deposit_percent}%` : "—";
}

/** One line per tier: "Up to $10,000 → 15%". */
export function DepositTiers({ tiers }: { tiers: DepositTier[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {tiers.map((t, i) => (
        <li key={i} className="flex justify-between gap-4">
          <span className="text-muted-foreground">
            {t.upTo != null ? `Up to ${money.format(t.upTo)}` : i === 0 ? "Any amount" : "Above that"}
          </span>
          <span className="font-medium tabular-nums">{t.percent}%</span>
        </li>
      ))}
    </ul>
  );
}

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  sku: "SKU",
  sign_now_template_id: "SignNow template",
  active: "Status",
  deposit_percent: "Deposit",
  deposit_tiers: "Deposit tiers",
};

function showValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "active") return v ? "Active" : "Inactive";
  if (field === "deposit_percent") return `${v}%`;
  if (field === "deposit_tiers" && Array.isArray(v)) {
    return (v as DepositTier[])
      .map((t) => `${t.upTo != null ? `≤ ${money.format(t.upTo)}` : "rest"}: ${t.percent}%`)
      .join(", ");
  }
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

const ACTION_LABEL: Record<string, string> = { created: "Added", updated: "Changed", deleted: "Deleted" };

/** Who changed what, newest first. */
export function ManufacturerHistory({ history, compact }: { history: ManufacturerChange[]; compact?: boolean }) {
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No changes recorded.</p>;
  return (
    <ul className="space-y-3">
      {history.map((h) => (
        <li key={h.id} className="text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">
              {ACTION_LABEL[h.action] ?? h.action} by{" "}
              {/* Inside the card (compact) a name stays plain text: one panel at a time. */}
              {h.actor_id && !compact ? <PersonLink id={h.actor_id} name={h.actor} /> : h.actor}
            </span>
            {h.at && (
              <span className="text-xs text-muted-foreground" title={fmtDateTimeUS(h.at)}>
                {compact ? fmtRelative(h.at, fmtDateUS) : fmtDateTimeUS(h.at)}
              </span>
            )}
          </div>
          {h.action === "updated" && h.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {h.changes.map((c, i) => (
                <li key={i} className="break-words">
                  {FIELD_LABEL[c.field] ?? c.field}: {showValue(c.field, c.oldValue)} → {" "}
                  <span className="text-foreground">{showValue(c.field, c.newValue)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

type FormState = { name: string; sku: string; sign_now_template_id: string; active: boolean };
const EMPTY: FormState = { name: "", sku: "", sign_now_template_id: "", active: true };

/** Add or edit a manufacturer. Deposits are read-only here (Strapi owns them). */
export function ManufacturerFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ManufacturerConfig | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      editing
        ? {
            name: editing.name,
            sku: editing.sku ?? "",
            sign_now_template_id: editing.sign_now_template_id ?? "",
            active: editing.active,
          }
        : EMPTY,
    );
  }, [open, editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(editing ? `/api/manufacturers/${editing.id}` : "/api/manufacturers", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        sign_now_template_id: form.sign_now_template_id.trim(),
        active: form.active,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) ?? {};
      setError(typeof body.error === "string" ? body.error : "Failed to save");
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Manufacturer" : "Add Manufacturer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="m-name">Name</Label>
              <Input id="m-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-sku">SKU</Label>
              <Input id="m-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-template">SignNow Template ID</Label>
            <Input
              id="m-template"
              value={form.sign_now_template_id}
              onChange={(e) => setForm({ ...form, sign_now_template_id: e.target.value })}
            />
          </div>

          <div className="space-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2">
            <p className="text-sm font-medium">Deposit{editing ? `: ${depositSummary(editing)}` : ""}</p>
            <p className="text-xs text-muted-foreground">
              Deposits are managed in Strapi — edit them there. They sync here automatically through the
              Manufacturer Hub and can&apos;t be changed in the launcher.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="m-active"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <Label htmlFor="m-active">Active</Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Activate / deactivate and delete, as confirmation requests for useConfirmAction. */
export function toggleActiveRequest(m: Pick<ManufacturerConfig, "id" | "name" | "active">) {
  const next = !m.active;
  return {
    title: next ? `Reactivate ${m.name}?` : `Deactivate ${m.name}?`,
    body: next
      ? "It becomes available again in the apps that use the manufacturer list."
      : "It's marked inactive for the apps that use the manufacturer list. Nothing is deleted, and you can reactivate it later.",
    action: next ? "Reactivate" : "Deactivate",
    destructive: !next,
    run: () =>
      fetch(`/api/manufacturers/${m.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      }),
  };
}

export function deleteRequest(m: Pick<ManufacturerConfig, "id" | "name">) {
  return {
    title: `Delete ${m.name}?`,
    body: "This removes the manufacturer and its Manufacturer Hub page for every app, and can't be undone. To keep it, deactivate it instead.",
    action: "Delete",
    destructive: true,
    run: () => fetch(`/api/manufacturers/${m.id}`, { method: "DELETE" }),
  };
}
