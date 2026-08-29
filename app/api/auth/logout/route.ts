import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The way out.
 *
 * There was none before, and there did not need to be: the cookie held a hash
 * of a password everybody shared, so "signing out" meant nothing — the next
 * person knew the same password. Now it names a person, and a name you cannot
 * put down is a problem on a shared machine.
 *
 * POST, not GET: a link that logs people out gets fetched by prefetchers and
 * link scanners, and the first sign of that is a colleague who cannot stay
 * signed in.
 *
 * This ends the session HERE. It does not end it at Fides — signing back in
 * will go through without a password, because the provider still knows the
 * browser. That is the right default for a shared identity (leaving Atlas
 * should not sign you out of everything), and it is worth knowing when the
 * question is "why am I straight back in".
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
