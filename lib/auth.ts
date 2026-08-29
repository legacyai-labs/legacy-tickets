/**
 * Who may enter the studio — decided at Fides ID now, not by a shared password.
 *
 * This used to hold ONE password from the env, and everybody who knew it was
 * "the human". It said nothing about which human, could not be taken away from
 * one person without changing it for all of them, and travelled by whatever
 * means people pass a password around. ADR-0014 in cortex is the reasoning; the
 * short version is that access should be granted and withdrawn in one place.
 *
 * What is left here is the session's shape and the question "is this app set up
 * to authenticate anybody at all". The answer is no unless a signing secret
 * exists — the same fail-closed rule as before, on a different secret.
 */
export const AUTH_COOKIE = "legacy_auth";

/** Is the human path configured? Without a signing secret no cookie this app
 *  issues can be verified, so it must not pretend to authenticate anyone. */
export function authEnabled(): boolean {
  return (process.env.FIDES_SESSION_SECRET || "").length > 0;
}

/** Is a provider configured — i.e. is there a door to send people to? */
export function issuerConfigured(): boolean {
  return Boolean(process.env.FIDES_ISSUER && process.env.FIDES_PUBLIC_URL);
}
