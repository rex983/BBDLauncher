import { ManufacturersShell } from "@/components/features/manufacturers/ManufacturersShell";

// The admin layout limits this page to admins + manager-tier; the list loads
// client-side from /api/manufacturers.
export default function AdminManufacturersPage() {
  return <ManufacturersShell />;
}
