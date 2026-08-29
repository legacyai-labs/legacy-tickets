import { NextResponse } from "next/server";
import { begin } from "@/lib/fides";
import { FLOW_COOKIE, sealFlow } from "@/lib/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leave for the provider.
 *
 * A redirect, not a fetch: the password is typed on the provider's own page, in
 * the address bar the person can check. What has to survive the round trip —
 * the state and the PKCE verifier — rides in a short-lived signed cookie rather
 * than in this process's memory, because there may not BE one process: a
 * restart, a second replica or a cold start would otherwise lose every login in
 * flight and answer "die Anmeldung ist abgelaufen" to somebody who just clicked.
 */
export async function GET() {
  try {
    const { url, attempt } = await begin();
    const res = NextResponse.redirect(url, { headers: { "cache-control": "no-store" } });
    res.cookies.set(FLOW_COOKIE, sealFlow(attempt), {
      httpOnly: true,
      sameSite: "lax", // the provider redirects BACK to us — strict would drop it
      path: "/api/auth",
      secure: url.startsWith("https:"),
      maxAge: 10 * 60,
    });
    return res;
  } catch (err) {
    console.error("[auth] Anmeldung konnte nicht beginnen:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Der Anmeldedienst ist nicht erreichbar." },
      { status: 502 },
    );
  }
}
