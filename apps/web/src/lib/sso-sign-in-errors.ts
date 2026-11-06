// Why a Cognito sign-in did not complete.
//
// Better Auth sends a failed sign-in back to the errorCallbackURL with its own
// `error` code appended. The login page owns the wording, and the code itself
// is never rendered, so nothing from the URL is reflected into the page.

export const COGNITO_SSO_PARAM = "sso";
export const COGNITO_ERROR_CALLBACK_URL = `/login?${COGNITO_SSO_PARAM}=cognito`;

const MESSAGES: Record<string, (provider: string) => string> = {
  signup_disabled: (provider) =>
    `There is no Wayfinder account for your ${provider} email address yet. Ask an administrator to create one, then sign in with ${provider} again.`,
  account_not_linked: (provider) =>
    `${provider} has not verified your email address, so it cannot be linked to your Wayfinder account. Verify it in ${provider}, then sign in again.`,
};

const fallback = (provider: string): string =>
  `Sign-in with ${provider} did not complete. Try again, or ask an administrator if it keeps failing.`;

export const cognitoSignInErrorMessage = (
  sso: string | null,
  error: string | null,
  provider: string,
): string | null => {
  if (sso !== "cognito" || !error) return null;
  // Own keys only: "constructor" or "__proto__" in the URL must not reach Object.prototype.
  const message = Object.hasOwn(MESSAGES, error) ? MESSAGES[error] : undefined;
  return message ? message(provider) : fallback(provider);
};
