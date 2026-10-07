import { redirect } from "next/navigation";

// Renamed; old Slack links still land here.
export default function RetiredMailRedirect() {
  redirect("/admin/email-monitor");
}
