export type QuoteSource = "manual" | "ai_cron" | "ai_manual" | "seed";

export interface MotivationalQuote {
  id: string;
  quote: string;
  author: string;
  source: QuoteSource;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
  created_by: string | null;
}
