import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The old door, kept only to say where the new one is.
 *
 * This took the shared studio password and set a cookie. Signing in happens at
 * Fides ID now (ADR-0014) — start at /api/auth/start. It answers rather than
 * 404s because a bookmark, a script or a stale tab may still post here, and
 * "gone, go there instead" is a better answer to those than "not found".
 */
export function POST() {
  return NextResponse.json(
    { error: "Die Anmeldung läuft über Fides ID.", start: "/api/auth/start" },
    { status: 410 },
  );
}
