import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, expectedToken } from "./auth";

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

/** True if the request carries a valid login cookie. Fails closed: no password
 *  configured means the cookie can never authenticate an API call. */
async function humanAuthed(): Promise<boolean> {
  if (!authEnabled()) return false;
  const jar = await cookies();
  return jar.get(AUTH_COOKIE)?.value === expectedToken();
}

/** Classify the caller. Service tokens win (they never coexist with a cookie). */
export async function authKind(req: NextRequest): Promise<AuthKind> {
  return kindOf(serviceAuthed(req), await humanAuthed());
}

/** Login cookie OR a service token — the gate on every /api route. */
export async function allowed(req: NextRequest): Promise<boolean> {
  return (await authKind(req)) !== null;
}
