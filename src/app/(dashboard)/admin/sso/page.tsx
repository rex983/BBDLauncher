"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Copy, Download } from "lucide-react";

interface AuditEntry {
  id: string;
  user_id: string;
  app_id: string;
  event_type: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export default function AdminSsoPage() {
  const [metadata, setMetadata] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    fetch("/api/saml/metadata")
      .then((r) => r.text())
      .then(setMetadata)
      .catch(() => {});

    // Fetch audit log via admin API — uses the apps API pattern
    fetch("/api/apps?audit=true")
      .then((r) => r.json())
      .then((data) => {
        if (data.audit) setAuditLog(data.audit);
      })
      .catch(() => {});
  }, []);

  const copyMetadata = () => {
    navigator.clipboard.writeText(metadata);
  };

  const downloadCert = () => {
    // The cert is embedded in the metadata
    const match = metadata.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/);
    if (match) {
      const pem = `-----BEGIN CERTIFICATE-----\n${match[1]}\n-----END CERTIFICATE-----`;
      const blob = new Blob([pem], { type: "application/x-pem-file" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bbd-idp-cert.pem";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SSO Overview</h1>
        <p className="text-muted-foreground">
          Identity Provider configuration and audit log
        </p>
      </div>

      <Tabs defaultValue="idp">
        <TabsList>
          <TabsTrigger value="idp">IdP Configuration</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="idp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                IdP Metadata
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyMetadata}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy XML
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadCert}>
                    <Download className="mr-2 h-4 w-4" />
                    Download Cert
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-md text-xs overflow-auto max-h-96">
                {metadata || "Loading metadata... (SAML certificate may not be configured yet)"}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata URL</CardTitle>
            </CardHeader>
            <CardContent>
              <code className="bg-muted px-2 py-1 rounded text-sm">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/saml/metadata`
                  : "/api/saml/metadata"}
              </code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>JWT SSO (Internal Apps)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">JWKS Endpoint</p>
                <code className="bg-muted px-2 py-1 rounded text-sm block">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/api/sso/jwks`
                    : "/api/sso/jwks"}
                </code>
              </div>
              <div className="text-sm text-muted-foreground space-y-2">
                <p className="font-medium">How to connect an internal app:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Create the app in the launcher with SSO Type = &quot;JWT&quot;</li>
                  <li>Set the ACS URL (e.g. <code>https://app.bigbuildings.app/api/sso/callback</code>)</li>
                  <li>Set the Audience identifier (e.g. <code>order-processing</code>)</li>
                  <li>In the target app: <code>npm install jose</code>, add a callback route that validates the token via JWKS, and create a local session</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLog.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm">
                    {new Date(entry.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.event_type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.user_id.substring(0, 8)}...
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {entry.details ? JSON.stringify(entry.details) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{entry.ip_address || "—"}</TableCell>
                </TableRow>
              ))}
              {auditLog.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No audit log entries yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
