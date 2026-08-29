import { createHmac, timingSafeEqual } from "node:crypto";
import type { Attempt } from "./fides";

/**
 * The login in flight, carried in a cookie instead of in memory.
 *
 * Atlas and Lens keep this in a Map: they are one long-lived process, and a
 * login interrupted by a deploy is a retry, not data worth persisting. A Next.js
 * route handler cannot assume that — a cold start or a second replica would
 * lose the Map and answer "expired" to somebody who just clicked. So the state
 * and the PKCE verifier travel with the browser, signed so they cannot be
 * chosen by whoever holds them, httpOnly so no script can read them, and
 * scoped to /api/auth so they are not sent with every request to the app.
 */
export const FLOW_COOKIE = "legacy_auth_flow";

function secret(): string {
  return process.env.FIDES_SESSION_SECRET || "";
}

export function sealFlow(attempt: Attempt): string {
  const key = secret();
  if (!key) throw new Error("FIDES_SESSION_SECRET fehlt — es gibt nichts zu unterschreiben.");
  const payload = Buffer.from(JSON.stringify(attempt)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

export function openFlow(cookie: string | undefined): Attempt | null {
  const key = secret();
  if (!key || !cookie) return null;
  const cut = cookie.lastIndexOf(".");
  if (cut <= 0) return null;
  const payload = cookie.slice(0, cut);
  const mac = Buffer.from(cookie.slice(cut + 1));
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest("base64url"));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const attempt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Attempt;
    return attempt.state && attempt.verifier && attempt.nonce ? attempt : null;
  } catch {
    return null;
  }
}
