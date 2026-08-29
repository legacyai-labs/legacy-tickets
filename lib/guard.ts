import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled } from "./auth";
import { open } from "./session";

/**
 * WHO is calling — this powers the delete boundary:
 *   "service" — Autopilot / gateway tokens (x-tickets-token or Bearer).
 *   "human"   — the board login cookie.
 *   null      — nobody we trust; the API fails CLOSED (an unconfigured deploy
 *               must not let the public write, and no anonymous reads either).
 */
export type AuthKind = "human" | "service" | null;

/** The minimal request surface we need — keeps the service check unit-testable. */
export interface HeaderCarrier {
  headers: { get(name: string): string | null };
}

/** True when the request presents a valid service token (fails closed when unset). */
export function serviceAuthed(req: HeaderCarrier): boolean {
  const svc = process.env.TICKETS_TOKEN;
  if (svc && req.headers.get("x-tickets-token") === svc) return true;
  const appToken = process.env.TICKETS_API_TOKEN;
  if (appToken && req.headers.get("authorization") === `Bearer ${appToken}`) return true; // nexus-injected gateway
  return false;
}

/** Pure combinator — the precedence rule, separated so it is unit-testable. */
export function kindOf(service: boolean, humanCookie: boolean): AuthKind {
  if (service) return "service";
  if (humanCookie) return "human";
  return null;
}

/** True if the request carries a valid session cookie. Fails closed: without a
 *  signing secret nothing this app issued can be verified, so nothing is.
 *
 *  The only change from the password era is WHAT the cookie has to be. It is no
 *  longer a constant to compare against but a signed statement to open, so this
 *  is a signature check and an expiry check rather than an equality test. The
 *  service path and the precedence rule are untouched on purpose. */
async function humanAuthed(): Promise<boolean> {
  if (!authEnabled()) return false;
  try {
    const jar = await cookies();
    return open(jar.get(AUTH_COOKIE)?.value) !== null;
  } catch {
    return false; // outside a request scope (e.g. unit tests) -> not a human
  }
}

/** WHO is here, for the pages that want to greet them. Null for a service
 *  caller — a machine has no name to show. */
export async function currentUser(): Promise<{ email: string; name: string } | null> {
  if (!authEnabled()) return null;
  try {
    const jar = await cookies();
    const session = open(jar.get(AUTH_COOKIE)?.value);
    return session ? { email: session.email, name: session.name } : null;
  } catch {
    return null;
  }
}

/** Classify the caller. Service tokens win (they never coexist with a cookie). */
export async function authKind(req: NextRequest): Promise<AuthKind> {
  return kindOf(serviceAuthed(req), await humanAuthed());
}

/** Login cookie OR a service token — the gate on every /api route. */
export async function allowed(req: NextRequest): Promise<boolean> {
  return (await authKind(req)) !== null;
}
