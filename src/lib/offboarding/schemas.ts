import { z } from "zod";
import { OFFBOARDING_CATEGORY_VALUES } from "./types";

// Checklist template item — shared by the create and update routes.
export const itemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  system: z.string().trim().min(1).max(100),
  category: z.enum(OFFBOARDING_CATEGORY_VALUES),
  instructions: z.string().max(2000).nullable().optional(),
  requires_note: z.boolean().optional(),
  default_assignee: z.string().uuid().nullable().optional(),
  display_order: z.number().int().min(0).max(100000).optional(),
  is_active: z.boolean().optional(),
});

