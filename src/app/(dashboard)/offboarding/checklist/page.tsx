import { getTemplate } from "@/lib/offboarding/service";
import { ChecklistTemplateShell } from "@/components/features/offboarding/ChecklistTemplateShell";

export default async function OffboardingChecklistPage() {
  const { sections, items } = await getTemplate();
  return <ChecklistTemplateShell initialSections={sections} initialItems={items} />;
}
