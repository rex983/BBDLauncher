import { createAdminClient } from "@/lib/supabase/admin";
import { listOffboarders } from "@/lib/offboarding/service";
import { ChecklistTemplateShell } from "@/components/features/offboarding/ChecklistTemplateShell";
import type { ChecklistItem } from "@/lib/offboarding/types";

export default async function OffboardingChecklistPage() {
  const supabase = createAdminClient();
  const [{ data }, offboarders] = await Promise.all([
    supabase
      .from("offboarding_checklist_items")
      .select("id, title, system, category, instructions, requires_note, default_assignee, display_order, is_active")
      .order("display_order"),
    listOffboarders(),
  ]);
  return (
    <ChecklistTemplateShell initialItems={(data || []) as ChecklistItem[]} offboarders={offboarders} />
  );
}
