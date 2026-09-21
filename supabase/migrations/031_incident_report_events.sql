-- Migration 31: audit log for incident reports.
--
-- Every state change on an incident_reports row (filed, edited, signed,
-- cancelled, admin override) writes a row here. The manager detail dialog
-- reads the events oldest → newest and renders an "Activity" timeline so
-- HR can see who touched a report and when, without pulling logs.
--
-- Kept as an append-only table on purpose — nothing in the app deletes or
-- updates rows here. If a compliance requirement ever calls for expiring
-- old events, that would be a separate scheduled purge.

CREATE TABLE IF NOT EXISTS incident_report_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cascade so purging an employee's incident file purges its audit trail
  -- with it — matches the incident_reports FK behavior.
  incident_report_id   UUID NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,

  -- Semantic tag for the row. Not FK'd to a lookup table — the strings are
  -- referenced from src/lib/incidents/audit.ts as a small enum and the UI
  -- renders labels per known type. Unknown types display verbatim.
  event_type           TEXT NOT NULL,

  actor_profile_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_ip             TEXT,
  actor_ua             TEXT,

  -- Free-form event payload. For "edited": {"changes": [{field, from, to}]}.
  -- For "cancelled": {"reason": "..."}. For "admin_override_*": whatever
  -- extra context the override captured.
  details              JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_report_events_report
  ON incident_report_events (incident_report_id, created_at);

ALTER TABLE incident_report_events ENABLE ROW LEVEL SECURITY;
