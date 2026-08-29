import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The cookie that says who is here — signed, because it now carries a claim.
 *
 * The old cookie was sha256(password|salt): a CONSTANT. Every session for a
 * given password was byte-identical, and that was fine, because it asserted
 * nothing except "somebody knew the password". The moment it carries an e-mail
 * and a name, that stops being fine — an unsigned identity cookie is a
 * self-service admin panel, and the browser is where it is stored.
 *
 * So: payload plus HMAC over it, with a per-app secret. The secret is the only
 * thing standing between a visitor and any identity they care to type, which is
 * why nothing here works at all when it is missing (see authEnabled()).
 *
 * Deliberately NOT a JWT. What Fides signed is a JWT and is verified as one;
 * this is our own session afterwards, it never leaves this app, and a format
 * with negotiable algorithms is a liability when there is nothing to negotiate.
 */
const ALGORITHM = "sha256";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface Session {
  /** The provider's stable subject — the identity, independent of the address. */
  sub: string;
  email: string;
  name: string;
  /** Unix seconds. Past this the cookie is simply not a session any more. */
  exp: number;
}

function secret(): string {
  return process.env.FIDES_SESSION_SECRET || "";
}

function sign(payload: string, key: string): string {
  return createHmac(ALGORITHM, key).update(payload).digest("base64url");
}

/** A session as it travels in the cookie: <payload>.<signature>. */
export function seal(session: Session): string {
  const key = secret();
  if (!key) throw new Error("FIDES_SESSION_SECRET fehlt — es gibt nichts zu unterschreiben.");
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Read a cookie back, or null.
 *
 * Every failure gives the same answer — no secret, wrong shape, bad signature,
 * expired. A caller that could tell them apart could use this as an oracle, and
 * there is nothing a visitor should learn here except "sign in again".
 */
export function open(cookie: string | undefined): Session | null {
  const key = secret();
  if (!key || !cookie) return null;
  const cut = cookie.lastIndexOf(".");
  if (cut <= 0) return null;
  const payload = cookie.slice(0, cut);
  const mac = Buffer.from(cookie.slice(cut + 1));
  const expected = Buffer.from(sign(payload, key));
  // Constant time: a byte-by-byte comparison leaks, one byte at a time, what
  // the right signature would have been.
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof session.exp !== "number" || session.exp * 1000 < Date.now()) return null;
    if (!session.sub || !session.email) return null;
    return session;
  } catch {
    return null;
  }
}
