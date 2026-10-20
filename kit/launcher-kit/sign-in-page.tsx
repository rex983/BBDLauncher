import { redirect } from "next/navigation";
import { APP_AUDIENCE, APP_NAME } from "./config";
import { signInErrorMessage, type SignInError } from "./sign-in-errors";
import { LAUNCHER_DASHBOARD_URL, launcherSignInUrl, safeNext } from "./urls";

// Each app's /login page:
//
//   import { LauncherSignInPage } from "@/lib/launcher-kit/sign-in-page";
//   export default async function LoginPage({ searchParams }: { searchParams: Promise<SignInSearchParams> }) {
//     return <LauncherSignInPage searchParams={await searchParams} />;
//   }
//
// Nobody signs in to an app on its own. A signed-out visit goes to the
// launcher, which sends them straight back signed in if they're signed in
// there. Only when they aren't (?signedOut=1), or sign-in failed (?error=),
// does this page show — with one button and no Google prompt.

export type SignInSearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Signed in on the launcher, but the launcher says no: another try won't help. */
const REFUSED: SignInError[] = ["NoProfile", "Inactive", "NoAppAccess"];

export function LauncherSignInPage({
  searchParams,
  messages,
}: {
  searchParams: SignInSearchParams;
  /** The app's own ?error= codes (old links, its auth.ts) → message. */
  messages?: Record<string, string>;
}) {
  const error = one(searchParams.error);
  const next = safeNext(one(searchParams.callbackUrl));
  if (!error && !one(searchParams.signedOut)) redirect(launcherSignInUrl(APP_AUDIENCE, next));

  const message = error
    ? signInErrorMessage(error) ?? messages?.[error] ?? "Sign-in didn't work. Try again."
    : null;
  const refused = !!error && REFUSED.includes(error as SignInError);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <h1 className="text-xl font-semibold">{APP_NAME}</h1>
        {message ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400">
            {message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">You&apos;re not signed in.</p>
        )}
        <a
          href={refused ? LAUNCHER_DASHBOARD_URL : launcherSignInUrl(APP_AUDIENCE, next, { login: true })}
          className="block w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {refused ? "Back to the launcher" : "Sign in on the launcher"}
        </a>
      </div>
    </div>
  );
}
