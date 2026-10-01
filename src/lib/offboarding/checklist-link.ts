// Links a case task back to its checklist item, so edits made on a case can
// flow into the checklist and every offboarding stays the same.

import { createAdminClient } from "@/lib/supabase/admin";

interface TaskRef {
  item_id: string | null;
  app_id: string | null;
  auto_action: string | null;
  title: string;
}

/** The checklist item a case task came from (null for per-app tasks or no match). */
export async function checklistItemFor(task: TaskRef): Promise<string | null> {
  if (task.app_id) return null;
  const supabase = createAdminClient();
  if (task.item_id) {
    const { data } = await supabase
      .from("offboarding_checklist_items")
      .select("id")
      .eq("id", task.item_id)
      .maybeSingle();
    if (data) return data.id;
  }
  if (task.auto_action) {
    const { data } = await supabase
      .from("offboarding_checklist_items")
      .select("id")
      .eq("auto_action", task.auto_action)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data } = await supabase
    .from("offboarding_checklist_items")
    .select("id")
    .ilike("title", task.title.replace(/[%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Section id for a section name, or null if the checklist has no such section. */
export async function sectionIdByName(name: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("offboarding_sections")
    .select("id")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
