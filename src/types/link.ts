import type { Office } from "@/types/auth";

export interface ImportantLink {
  id: string;
  name: string;
  description: string | null;
  url: string;
  icon_url: string | null;
  display_order: number;
  office: Office | null;
  created_at: string;
  updated_at: string;
}
