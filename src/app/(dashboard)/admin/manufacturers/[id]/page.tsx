import { notFound } from "next/navigation";
import { loadManufacturerDetail } from "@/lib/manufacturers/summary";
import { ManufacturerDetailShell } from "@/components/features/manufacturers/ManufacturerDetailShell";

// One manufacturer: what the launcher holds about it, its deposit as synced
// from Strapi, and who changed what. The admin layout limits this to admins
// + manager-tier.
export default async function ManufacturerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manufacturer = await loadManufacturerDetail(id);
  if (!manufacturer) notFound();
  return <ManufacturerDetailShell manufacturer={manufacturer} />;
}
