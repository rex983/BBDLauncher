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
