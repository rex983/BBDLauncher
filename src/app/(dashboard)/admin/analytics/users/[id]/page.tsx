import { redirect } from "next/navigation";

// A person's profile now lives under Users (/admin/users/[id]); old links
// and bookmarks land there.
export default async function LegacyUserAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const { range } = await searchParams;
  redirect(`/admin/users/${encodeURIComponent(id)}${range ? `?range=${encodeURIComponent(range)}` : ""}`);
}
