import { z } from "zod";

// Checklist template item — shared by the create and update routes.
export const itemSchema = z.object({
  section_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  system: z.string().trim().max(100).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  requires_note: z.boolean().optional(),
  display_order: z.number().int().min(0).max(100000).optional(),
  is_active: z.boolean().optional(),
});

export const sectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// New order for the whole template: sections top to bottom, and each item's
// section + position.
export const reorderSchema = z.object({
  sections: z.array(z.string().uuid()).max(200),
  items: z.array(z.object({ id: z.string().uuid(), section_id: z.string().uuid() })).max(2000),
});
