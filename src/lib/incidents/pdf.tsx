// @react-pdf/renderer document for incident reports. Produces a
// legal-looking PDF suitable for HR filing, printing, or sharing
// externally. Rendered server-side by /api/incidents/[id]/pdf so the
// output is deterministic (no client-side font loading quirks) and the
// endpoint can enforce the manager_notes visibility rule.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type React from "react";
import {
  formatIncidentNumber,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentAttachment,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";

export interface IncidentPdfData {
  number: number | null;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  problem: string | null;
  proposed_solution: string | null;
  manager_notes: string | null; // only rendered when includeManagerNotes is true
  document: string; // fallback for legacy reports
  acknowledgement_text: string;
  attachments: IncidentAttachment[] | null;
  manager_signed_at: string | null;
  manager_signature_text: string | null;
  manager_signature_hash: string | null;
  employee_signed_at: string | null;
  employee_signature_text: string | null;
  employee_signature_hash: string | null;
  document_hash: string | null;
  created_at: string;
  reporter_name: string | null;
  employee_name: string | null;
  employee_email: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
    lineHeight: 1.4,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 12,
    marginBottom: 18,
  },
  company: {
    fontSize: 9,
    letterSpacing: 1,
    color: "#666",
    textTransform: "uppercase",
  },
  docTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  reportNumber: {
    fontSize: 10,
    color: "#666",
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
  },
  metaBlock: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
    gap: 12,
  },
  metaField: {
    width: "48%",
    marginBottom: 8,
  },
  metaLabel: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  section: {
    marginBottom: 14,
  },
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#d0d0d0",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bodyText: {
    fontSize: 10,
    lineHeight: 1.5,
  },
  privateBox: {
    borderWidth: 1,
    borderColor: "#e0a020",
    backgroundColor: "#fef7e6",
    padding: 8,
    marginBottom: 14,
  },
  privateLabel: {
    fontSize: 8,
    color: "#a06010",
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ackBox: {
    borderWidth: 1,
    borderColor: "#c0c0c0",
    backgroundColor: "#f7f7f7",
    padding: 10,
    marginBottom: 14,
  },
  attachmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e0e0e0",
  },
  signatureGrid: {
    flexDirection: "row",
    marginTop: 8,
    marginBottom: 18,
    gap: 24,
  },
  signatureBlock: {
    flex: 1,
    borderTopWidth: 1.5,
    borderTopColor: "#1a1a1a",
    paddingTop: 6,
  },
  signatureName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  signatureRole: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  signatureMeta: {
    fontSize: 8,
    color: "#666",
    marginTop: 2,
  },
  signatureHash: {
    fontSize: 6.5,
    color: "#888",
    fontFamily: "Courier",
    marginTop: 4,
  },
  unsigned: {
    fontSize: 9,
    color: "#999",
    fontStyle: "italic",
    marginTop: 4,
  },
  hashBox: {
    marginTop: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: "#d0d0d0",
    backgroundColor: "#fafafa",
  },
  hashHeading: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hashLine: {
    fontSize: 7,
    fontFamily: "Courier",
    color: "#444",
    marginTop: 2,
  },
  hashNote: {
    fontSize: 8,
    color: "#666",
    marginTop: 6,
    lineHeight: 1.3,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    fontSize: 8,
    color: "#999",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#d0d0d0",
    paddingTop: 6,
  },
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function IncidentReportPdfDoc({
  data,
  includeManagerNotes,
}: {
  data: IncidentPdfData;
  includeManagerNotes: boolean;
}): React.ReactElement {
  const numberLabel = formatIncidentNumber(data.number);
  const hasSplitSections = data.problem !== null || data.proposed_solution !== null;

  return (
    <Document
      title={`Incident Report ${numberLabel}`}
      author={data.reporter_name || "BBD Management"}
      subject={data.title}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>Big Buildings Direct — HR Records</Text>
          <Text style={styles.docTitle}>Incident Report</Text>
          <Text style={styles.reportNumber}>
            {numberLabel} · {data.title}
          </Text>
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Employee</Text>
            <Text style={styles.metaValue}>{data.employee_name || "—"}</Text>
            {data.employee_email && (
              <Text style={{ fontSize: 9, color: "#666" }}>
                {data.employee_email}
              </Text>
            )}
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Filed by</Text>
            <Text style={styles.metaValue}>{data.reporter_name || "—"}</Text>
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Filed on</Text>
            <Text style={styles.metaValue}>{fmtDate(data.created_at)}</Text>
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Date of incident</Text>
            <Text style={styles.metaValue}>{fmtDate(data.occurred_at)}</Text>
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Severity</Text>
            <Text style={styles.metaValue}>
              {INCIDENT_SEVERITY_LABEL[data.severity]}
            </Text>
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Category</Text>
            <Text style={styles.metaValue}>
              {INCIDENT_CATEGORY_LABEL[data.category]}
            </Text>
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>
              {INCIDENT_STATUS_LABEL[data.status]}
            </Text>
          </View>
        </View>

        {hasSplitSections ? (
          <>
            {data.problem && (
              <View style={styles.section}>
                <Text style={styles.sectionHeading}>Problem</Text>
                <Text style={styles.bodyText}>{data.problem}</Text>
              </View>
            )}
            {data.proposed_solution && (
              <View style={styles.section}>
                <Text style={styles.sectionHeading}>
                  Proposed Solution &amp; Deadline
                </Text>
                <Text style={styles.bodyText}>{data.proposed_solution}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Report</Text>
            <Text style={styles.bodyText}>{data.document}</Text>
          </View>
        )}

        {includeManagerNotes && data.manager_notes && (
          <View style={styles.privateBox}>
            <Text style={styles.privateLabel}>
              Manager&rsquo;s Notes — Confidential, HR / Management Only
            </Text>
            <Text style={styles.bodyText}>{data.manager_notes}</Text>
          </View>
        )}

        <View style={styles.ackBox}>
          <Text style={{ ...styles.sectionHeading, borderBottomWidth: 0, marginBottom: 4, paddingBottom: 0 }}>
            Employee Acknowledgement
          </Text>
          <Text style={styles.bodyText}>{data.acknowledgement_text}</Text>
        </View>

        {Array.isArray(data.attachments) && data.attachments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>
              Attachments ({data.attachments.length})
            </Text>
            {data.attachments.map((a) => (
              <View key={a.path} style={styles.attachmentRow}>
                <Text style={{ fontSize: 9, flex: 1 }}>{a.filename}</Text>
                <Text style={{ fontSize: 8, color: "#666" }}>
                  {formatBytes(a.size)} · {a.mime}
                </Text>
              </View>
            ))}
            <Text style={{ ...styles.hashNote, marginTop: 6 }}>
              Original attachment files are retained in the BBD Launcher
              record under this report number and remain accessible to
              authorized viewers.
            </Text>
          </View>
        )}

        <Text style={styles.sectionHeading}>Signatures</Text>
        <View style={styles.signatureGrid}>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureRole}>Manager / Reporter</Text>
            {data.manager_signed_at ? (
              <>
                <Text style={styles.signatureName}>
                  {data.manager_signature_text || "—"}
                </Text>
                <Text style={styles.signatureMeta}>
                  Signed {fmtDate(data.manager_signed_at)}
                </Text>
                {data.manager_signature_hash && (
                  <Text style={styles.signatureHash}>
                    Sig SHA-256: {data.manager_signature_hash}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.unsigned}>Not yet signed</Text>
            )}
          </View>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureRole}>Employee</Text>
            {data.employee_signed_at ? (
              <>
                <Text style={styles.signatureName}>
                  {data.employee_signature_text || "—"}
                </Text>
                <Text style={styles.signatureMeta}>
                  Signed {fmtDate(data.employee_signed_at)}
                </Text>
                {data.employee_signature_hash && (
                  <Text style={styles.signatureHash}>
                    Sig SHA-256: {data.employee_signature_hash}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.unsigned}>Not yet signed</Text>
            )}
          </View>
        </View>

        {data.document_hash && (
          <View style={styles.hashBox}>
            <Text style={styles.hashHeading}>Document Integrity</Text>
            <Text style={styles.hashLine}>
              Body SHA-256: {data.document_hash}
            </Text>
            <Text style={styles.hashNote}>
              This SHA-256 hash proves the report body captured at the
              manager&rsquo;s signature has not been altered. If the body were
              edited after signing, this hash would no longer match, and
              the signatures above would be invalidated.
            </Text>
          </View>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${numberLabel} — Big Buildings Direct — Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
