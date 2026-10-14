# Launcher kit

The code every BBD app uses to sign in through the launcher and keep its
users and roles in sync with it. It is copied, unchanged, into each app's
`src/lib/launcher-kit/`. This folder is the only place to edit it.

| File | What it does |
|---|---|
| `verifier.ts` | Verifies the launcher's sign-in token (ES256, 60s, single use, optional View-as `act` claim) |
| `access.ts` | `checkLauncherAccess`, `resolvePermissionRole` ("Permissions like"), `launcherAppMembers` |
| `session.ts` | `launcherSignIn` (every provider) and `recheckLauncherSession` (the 60s recheck) |
| `view-as.ts` | Read-only View as: `viewAsWriteBlock` for middleware, `assertNotViewingAs` for server code |
| `view-as-banner.tsx` | The "Viewing as … read-only" banner with Exit |
| `org.ts` | Offices, departments and roles from the launcher, cached 60s |
| `sign-in-errors.ts` | Error codes and messages for the login page |
| `urls.ts` | Launcher URLs (`NEXT_PUBLIC_LAUNCHER_URL` overrides) |
| `config.example.ts` | Template for the one per-app file, `config.ts` (audience, name, DB client) |

The rules themselves live in the shared database (launcher migrations 049
and 051: `launcher_can_open_app`, `launcher_permission_role`,
`launcher_app_members`). This kit only asks them.

## Changing it

1. Edit the file here.
2. `node kit/sync.mjs` copies it into every app checked out next to this repo
   (`C:\Users\Redir\<app>`).
3. Type-check and commit each app.

`node kit/sync.mjs --check` lists apps whose copy has drifted.

What stays in each app: its `auth.ts` (providers, break-glass, how fields
map onto its session), its middleware allow-list, and its own role rules
(what a senior manager may do in that app).
