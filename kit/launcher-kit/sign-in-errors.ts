import { APP_NAME } from "./config";

// Error codes launcherSignIn() returns. Apps redirect to their login page
// with ?error=<code> and show the message.
//
// Server-only: this imports ./config, which loads the service-role client.
// Build the message in a server component (e.g. the login page) and pass the
// string to client components as a prop.

export type SignInError =
  | "NoProfile"
  | "Inactive"
  | "NoAppAccess"
  | "LauncherUnavailable"
  | "ViewAsDenied"
  | "SsoInvalid";

export const SIGN_IN_ERROR_MESSAGES: Record<SignInError, string> = {
  NoProfile: "There's no BBD account for this email. Ask an admin to add you in the BBD Launcher.",
  Inactive: "Your BBD account is deactivated. Ask an admin in the BBD Launcher.",
  NoAppAccess: `You don't have access to ${APP_NAME} in the BBD Launcher. Ask an admin if you need it.`,
  LauncherUnavailable: "Couldn't confirm your launcher access — try again in a moment.",
  ViewAsDenied: "This View as link isn't valid. Start View as again from the BBD Launcher.",
  SsoInvalid: "That sign-in link expired or was already used. Open the app from the BBD Launcher again.",
};

/** Message for an ?error= code, or null for codes this kit doesn't own. */
export function signInErrorMessage(code: string | null | undefined): string | null {
  return code && code in SIGN_IN_ERROR_MESSAGES
    ? SIGN_IN_ERROR_MESSAGES[code as SignInError]
    : null;
}
