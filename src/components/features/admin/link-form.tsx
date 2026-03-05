"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ImportantLink } from "@/types/link";

interface LinkFormProps {
  link?: ImportantLink | null;
  onSaved: () => void;
}

export function LinkForm({ link, onSaved }: LinkFormProps) {
  const [name, setName] = useState(link?.name || "");
  const [description, setDescription] = useState(link?.description || "");
  const [url, setUrl] = useState(link?.url || "");
  const [iconUrl, setIconUrl] = useState(link?.icon_url || "");
  const [displayOrder, setDisplayOrder] = useState(link?.display_order ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const payload = {
      name,
      description: description || null,
      url,
      icon_url: iconUrl || null,
      display_order: displayOrder,
    };

    const res = link
      ? await fetch(`/api/links/${link.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setSaving(false);
    if (res.ok) onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Adobe Acrobat Reader"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of the link"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="url">URL *</Label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/download"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="icon_url">Icon URL</Label>
        <Input
          id="icon_url"
          value={iconUrl}
          onChange={(e) => setIconUrl(e.target.value)}
          placeholder="https://example.com/favicon.ico"
        />
        <p className="text-xs text-muted-foreground">
          Tip: Use the site&apos;s favicon — usually at https://domain.com/favicon.ico
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display_order">Display Order</Label>
        <Input
          id="display_order"
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(Number(e.target.value))}
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving..." : link ? "Update Link" : "Create Link"}
      </Button>
    </form>
  );
}
