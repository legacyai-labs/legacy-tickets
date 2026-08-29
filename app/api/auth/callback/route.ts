import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { complete, onPublicUrl, servedSecurely } from "@/lib/fides";
import { FLOW_COOKIE, openFlow } from "@/lib/flow";
import { seal, SESSION_TTL_SECONDS } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Back from the provider.
 *
 * Errors travel to the sign-in screen as text, not as a stack trace on a blank
 * page: whoever is standing there needs to know what to do next, and the two
 * things that go wrong here — "try again" and "ask for access" — need opposite
 * repairs.
 */
export async function GET(req: NextRequest) {
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(onPublicUrl(`/login?${new URLSearchParams(params)}`, req.url), {
      headers: { "cache-control": "no-store" },
    });

  const attempt = openFlow(req.cookies.get(FLOW_COOKIE)?.value);
  const state = req.nextUrl.searchParams.get("state") ?? "";
  // Single use, and tied to THIS attempt: without the state check anybody could
  // hand a victim's browser a code of their choosing and have it redeemed here.
  if (!attempt || attempt.state !== state) {
    return back({ error: "Die Anmeldung ist abgelaufen. Bitte noch einmal." });
  }

  const who = await complete(req.nextUrl.searchParams.get("code") ?? "", attempt);
  if ("error" in who) return back({ error: who.error });

  const res = NextResponse.redirect(onPublicUrl("/board", req.url), {
    headers: { "cache-control": "no-store" },
  });
  res.cookies.set(AUTH_COOKIE, seal({
    sub: who.sub,
    email: who.email,
    name: who.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: servedSecurely(),
    maxAge: SESSION_TTL_SECONDS,
  });
  // The attempt is spent — leaving it would let a replayed callback look fresh.
  res.cookies.set(FLOW_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
