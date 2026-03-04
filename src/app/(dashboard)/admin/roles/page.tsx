import { createAdminClient } from "@/lib/supabase/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AdminRolesPage() {
  const supabase = createAdminClient();

  const { data: roles } = await supabase
    .from("launcher_roles")
    .select("*")
    .order("name");

  // Get user counts per role
  const { data: profiles } = await supabase
    .from("profiles")
    .select("role");

  const userCounts: Record<string, number> = {};
  profiles?.forEach((p) => {
    userCounts[p.role] = (userCounts[p.role] || 0) + 1;
  });

  // Get app counts per role
  const { data: access } = await supabase
    .from("launcher_role_app_access")
    .select("role_name");

  const appCounts: Record<string, number> = {};
  access?.forEach((a) => {
    appCounts[a.role_name] = (appCounts[a.role_name] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roles</h1>
        <p className="text-muted-foreground">
          Overview of all roles and their assignments
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Admin</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Apps</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles?.map((role) => (
            <TableRow key={role.name}>
              <TableCell className="font-mono text-sm">{role.name}</TableCell>
              <TableCell className="font-medium">{role.display_name}</TableCell>
              <TableCell className="text-muted-foreground">
                {role.description || "—"}
              </TableCell>
              <TableCell>
                {role.is_admin ? (
                  <Badge variant="default">Yes</Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}
              </TableCell>
              <TableCell>{userCounts[role.name] || 0}</TableCell>
              <TableCell>{appCounts[role.name] || 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
