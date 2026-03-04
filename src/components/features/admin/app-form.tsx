"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppWithAccess, LauncherRole, SsoType, AppStatus } from "@/types/app";

interface AppFormProps {
  app?: AppWithAccess | null;
  onSaved: () => void;
}

export function AppForm({ app, onSaved }: AppFormProps) {
  const [name, setName] = useState(app?.name || "");
  const [description, setDescription] = useState(app?.description || "");
  const [url, setUrl] = useState(app?.url || "");
  const [iconUrl, setIconUrl] = useState(app?.icon_url || "");
  const [ssoType, setSsoType] = useState<SsoType>(app?.sso_type || "none");
  const [status, setStatus] = useState<AppStatus>(app?.status || "active");
  const [displayOrder, setDisplayOrder] = useState(app?.display_order || 0);
  const [openInNewTab, setOpenInNewTab] = useState(app?.open_in_new_tab ?? true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(app?.roles || []);
  const [roles, setRoles] = useState<LauncherRole[]>([]);
  const [saving, setSaving] = useState(false);

  // SAML fields
  const [spEntityId, setSpEntityId] = useState(app?.sso_config?.sp_entity_id || "");
  const [acsUrl, setAcsUrl] = useState(app?.sso_config?.acs_url || "");
  const [sloUrl, setSloUrl] = useState(app?.sso_config?.slo_url || "");

  // OAuth fields
  const [oauthClientId, setOauthClientId] = useState(app?.sso_config?.oauth_client_id || "");
  const [oauthClientSecret, setOauthClientSecret] = useState(app?.sso_config?.oauth_client_secret || "");
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState(app?.sso_config?.oauth_authorize_url || "");
  const [oauthTokenUrl, setOauthTokenUrl] = useState(app?.sso_config?.oauth_token_url || "");

  useEffect(() => {
    fetch("/api/roles")
      .then((r) => r.json())
      .then(setRoles)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const body = {
      name,
      description: description || null,
      url,
      icon_url: iconUrl || null,
      sso_type: ssoType,
      status,
      display_order: displayOrder,
      open_in_new_tab: openInNewTab,
      roles: selectedRoles,
      sso_config:
        ssoType === "saml"
          ? { sp_entity_id: spEntityId, acs_url: acsUrl, slo_url: sloUrl }
          : ssoType === "oauth"
            ? {
                oauth_client_id: oauthClientId,
                oauth_client_secret: oauthClientSecret,
                oauth_authorize_url: oauthAuthorizeUrl,
                oauth_token_url: oauthTokenUrl,
              }
            : null,
    };

    const res = app
      ? await fetch(`/api/apps/${app.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/apps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    setSaving(false);
    if (res.ok) onSaved();
  };

  const toggleRole = (roleName: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleName)
        ? prev.filter((r) => r !== roleName)
        : [...prev, roleName]
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">URL</Label>
          <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="icon_url">Icon URL</Label>
          <Input id="icon_url" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="display_order">Display Order</Label>
          <Input
            id="display_order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>SSO Type</Label>
          <Select value={ssoType} onValueChange={(v) => setSsoType(v as SsoType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="direct_link">Direct Link</SelectItem>
              <SelectItem value="saml">SAML</SelectItem>
              <SelectItem value="oauth">OAuth</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as AppStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Open in New Tab</Label>
          <Select
            value={openInNewTab ? "yes" : "no"}
            onValueChange={(v) => setOpenInNewTab(v === "yes")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {ssoType === "saml" && (
        <div className="space-y-4 border rounded-lg p-4">
          <h3 className="font-semibold">SAML Configuration</h3>
          <div className="space-y-2">
            <Label>SP Entity ID</Label>
            <Input value={spEntityId} onChange={(e) => setSpEntityId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ACS URL</Label>
            <Input value={acsUrl} onChange={(e) => setAcsUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>SLO URL</Label>
            <Input value={sloUrl} onChange={(e) => setSloUrl(e.target.value)} />
          </div>
        </div>
      )}

      {ssoType === "oauth" && (
        <div className="space-y-4 border rounded-lg p-4">
          <h3 className="font-semibold">OAuth Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input
                type="password"
                value={oauthClientSecret}
                onChange={(e) => setOauthClientSecret(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Authorize URL</Label>
            <Input value={oauthAuthorizeUrl} onChange={(e) => setOauthAuthorizeUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Token URL</Label>
            <Input value={oauthTokenUrl} onChange={(e) => setOauthTokenUrl(e.target.value)} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Role Access</Label>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <button
              key={role.name}
              type="button"
              onClick={() => toggleRole(role.name)}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                selectedRoles.includes(role.name)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-accent"
              }`}
            >
              {role.display_name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : app ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}
