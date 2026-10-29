import { redirect } from "next/navigation";

// Short link: the edit history lives under Admin.
export default function AuditRedirect() {
  redirect("/admin/audit");
}
