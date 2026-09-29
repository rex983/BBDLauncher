"use client";

import { ACCESS_OFFICES, ACCESS_OFFICE_LABEL, type AccessCell, type AccessOffice } from "@/lib/launcher/access";
import type { LauncherRole } from "@/types/app";

const key = (office: string, role: string) => `${office}|${role}`;

/**
 * Who can open an app, as an office × role grid. Tick = people with that role
 * in that office can open it. Admins aren't limited by office, so they get one
 * checkbox instead of a column. Click an office or role heading to flip a row
 * or column.
 */
export function AppAccessGrid({
  roles,
  cells,
  onChange,
}: {
  roles: LauncherRole[];
  cells: AccessCell[];
  onChange: (next: AccessCell[]) => void;
}) {
  const on = new Set(cells.map((c) => key(c.office, c.role)));
  const adminRole = roles.find((r) => r.name === "admin");
  const gridRoles = roles.filter((r) => r.name !== "admin");
  const adminOn = !!adminRole && ACCESS_OFFICES.some((o) => on.has(key(o, "admin")));

  const emit = (set: Set<string>) =>
    onChange(
      [...set].map((k) => {
        const [office, role] = k.split("|") as [AccessOffice, string];
        return { office, role };
      }),
    );
  const flip = (keys: string[]) => {
    const next = new Set(on);
    const anyOff = keys.some((k) => !next.has(k));
    for (const k of keys) {
      if (anyOff) next.add(k);
      else next.delete(k);
    }
    emit(next);
  };
  const setAdmin = (value: boolean) => {
    const next = new Set([...on].filter((k) => !k.endsWith("|admin")));
    if (value) for (const o of ACCESS_OFFICES) next.add(key(o, "admin"));
    emit(next);
  };

  const summary = ACCESS_OFFICES.map((o) => {
    const allowed = gridRoles.filter((r) => on.has(key(o, r.name)));
    const text =
      allowed.length === 0 ? "no one" : allowed.length === gridRoles.length ? "everyone" : allowed.map((r) => r.display_name).join(", ");
    return { o, text, limited: allowed.length < gridRoles.length };
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => emit(new Set([...ACCESS_OFFICES.flatMap((o) => roles.map((r) => key(o, r.name)))]))}
          className="rounded-md border px-2 py-0.5 hover:bg-accent"
        >
          Everyone
        </button>
        <button type="button" onClick={() => emit(new Set())} className="rounded-md border px-2 py-0.5 hover:bg-accent">
          No one
        </button>
        <span className="text-muted-foreground">Click an office or role heading to flip the whole row or column.</span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 bg-muted/50 px-2 py-1.5 text-left font-medium text-muted-foreground">Office</th>
              {gridRoles.map((r) => (
                <th key={r.name} className="px-1.5 py-1.5 text-center font-medium">
                  <button
                    type="button"
                    onClick={() => flip(ACCESS_OFFICES.map((o) => key(o, r.name)))}
                    className="rounded px-1 hover:bg-accent"
                    title={`Every office, ${r.display_name}`}
                  >
                    {r.display_name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_OFFICES.map((o) => (
              <tr key={o} className="border-t">
                <th className="sticky left-0 bg-background px-2 py-1 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => flip(gridRoles.map((r) => key(o, r.name)))}
                    className={`rounded px-1 text-left hover:bg-accent ${o === "none" ? "italic text-muted-foreground" : ""}`}
                    title={`Every role in ${ACCESS_OFFICE_LABEL[o]}`}
                  >
                    {ACCESS_OFFICE_LABEL[o]}
                  </button>
                </th>
                {gridRoles.map((r) => (
                  <td key={r.name} className="px-1.5 py-1 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={on.has(key(o, r.name))}
                      onChange={() => flip([key(o, r.name)])}
                      aria-label={`${ACCESS_OFFICE_LABEL[o]} ${r.display_name}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adminRole ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={adminOn} onChange={(e) => setAdmin(e.target.checked)} />
          {adminRole.display_name}s can open it <span className="text-xs text-muted-foreground">(from any office)</span>
        </label>
      ) : null}

      <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-snug">
        <span className="font-semibold">Who can open it: </span>
        {summary.map((s, i) => (
          <span key={s.o}>
            {i ? " · " : ""}
            <span className={s.limited ? "text-amber-700 dark:text-amber-400" : undefined}>
              {ACCESS_OFFICE_LABEL[s.o]}: {s.text}
            </span>
          </span>
        ))}
        {adminRole ? ` · ${adminRole.display_name}s: ${adminOn ? "yes" : "no"}` : ""}
      </p>
    </div>
  );
}
