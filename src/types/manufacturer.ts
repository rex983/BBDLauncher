export interface DepositTier {
  upTo: number | null;
  percent: number;
}

export interface ManufacturerConfig {
  id: string;
  name: string;
  sku: string | null;
  sign_now_template_id: string;
  deposit_percent: number | null;
  deposit_tiers: DepositTier[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** A manufacturer plus what the Manufacturer Hub keeps about it (all optional). */
export interface ManufacturerRow extends ManufacturerConfig {
  logo_url: string | null;
  headline: string | null;
  hq_location: string | null;
  /** Its page in the Manufacturer Hub. */
  hub_url: string | null;
}

export interface ManufacturerChange {
  id: string;
  at: string | null;
  /** "created" | "updated" | "deleted" */
  action: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  /** Profile id when a person made the change (clickable name). */
  actor_id: string | null;
  actor: string;
}

export interface ManufacturerDetail extends ManufacturerRow {
  history: ManufacturerChange[];
}
