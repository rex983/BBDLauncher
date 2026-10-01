import type { Office } from "@/types/auth";

export interface ImportantLink {
  id: string;
  name: string;
  description: string | null;
  url: string;
  icon_url: string | null;
  display_order: number;
  office: Office | null;
  /** Shown only to the people named on it (migration 040). */
  people_only?: boolean;
  /** People named on the link — admin list only. */
  user_ids?: string[];
  created_at: string;
  updated_at: string;
}
