import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamScope } from "@/lib/auth/permissions";
import { getOffices } from "@/lib/org/lists";
import { loadTeamPeople, loadTeams, TeamsMissingError, type Team, type TeamPerson } from "@/lib/teams";
import TeamsShell from "./TeamsShell";

// Team leaders and the reps on their teams. Admins see every office;
// managers their own. Other apps read these through the launcher kit
// (getLauncherTeams) — Rep Insights builds team analytics from them.
export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const scope = teamScope(session.user.permRole, session.user.office);
  if (!scope.allowed) {
    return <TeamsShell initialTeams={[]} initialPeople={[]} offices={[]} fixedOffice={null} setupError="You need an office assigned to manage teams. Ask an admin to set one in Users." />;
  }

  const supabase = createAdminClient();
  let teams: Team[] = [];
  let people: TeamPerson[] = [];
  let setupError: string | null = null;
  try {
    [teams, people] = await Promise.all([loadTeams(supabase, scope.office), loadTeamPeople(supabase, scope.office)]);
  } catch (e) {
    setupError = e instanceof TeamsMissingError ? e.message : `Couldn't load teams: ${(e as Error).message}`;
  }
  const offices = (await getOffices()).map((o) => ({ name: o.name, display_name: o.display_name }));

  return (
    <TeamsShell
      initialTeams={teams}
      initialPeople={people}
      offices={offices}
      fixedOffice={scope.office}
      setupError={setupError}
    />
  );
}
