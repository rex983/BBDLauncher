"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, ExternalLink, Pencil, Power, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateUS } from "@/components/shared/format";
import { useConfirmAction } from "@/components/shared/confirm";
import type { ManufacturerDetail } from "@/types/manufacturer";
import {
  DepositTiers,
  ManufacturerFormDialog,
  ManufacturerHistory,
  ManufacturerLogo,
  deleteRequest,
  toggleActiveRequest,
} from "./manufacturer-parts";

// A manufacturer's full page (/admin/manufacturers/[id]).
export function ManufacturerDetailShell({ manufacturer: m }: { manufacturer: ManufacturerDetail }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = useConfirmAction(() => router.refresh());
  const remove = useConfirmAction(() => router.push("/admin/manufacturers"));

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(m.sign_now_template_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the id is on screen to select.
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/manufacturers">
            <ArrowLeft className="h-4 w-4" />
            Manufacturers
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <ManufacturerLogo id={m.id} name={m.name} logoUrl={m.logo_url} size={96} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{m.name}</h1>
              {m.headline && <p className="mt-1 text-sm text-muted-foreground">{m.headline}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={m.active ? "default" : "secondary"}>{m.active ? "Active" : "Inactive"}</Badge>
                {m.sku && <Badge variant="outline">SKU {m.sku}</Badge>}
                {m.hq_location && <Badge variant="outline">{m.hq_location}</Badge>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Added {fmtDateUS(m.created_at)} · Updated {fmtDateUS(m.updated_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {m.hub_url && (
              <Button asChild variant="outline" size="sm">
                <a href={m.hub_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Manufacturer Hub
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh.ask(toggleActiveRequest(m))}>
              <Power className="h-4 w-4" />
              {m.active ? "Deactivate" : "Reactivate"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete"
              aria-label={`Delete ${m.name}`}
              onClick={() => remove.ask(deleteRequest(m))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      <ManufacturerFormDialog open={editOpen} onOpenChange={setEditOpen} editing={m} onSaved={() => router.refresh()} />
      {refresh.dialog}
      {remove.dialog}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SignNow template</CardTitle>
          </CardHeader>
          <CardContent>
            {m.sign_now_template_id ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">{m.sign_now_template_id}</code>
                <Button variant="ghost" size="icon-sm" title="Copy template ID" onClick={copyTemplate}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not set. Add the template ID with Edit.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deposit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.deposit_tiers && m.deposit_tiers.length > 0 ? (
              <DepositTiers tiers={m.deposit_tiers} />
            ) : m.deposit_percent != null ? (
              <p className="text-2xl font-semibold tabular-nums">{m.deposit_percent}%</p>
            ) : (
              <p className="text-sm text-muted-foreground">No deposit synced yet.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Managed in Strapi and synced through the Manufacturer Hub. It can&apos;t be changed here.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change history</CardTitle>
        </CardHeader>
        <CardContent>
          <ManufacturerHistory history={m.history} />
        </CardContent>
      </Card>
    </div>
  );
}
