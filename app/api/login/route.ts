import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, checkPassword, expectedToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ ok: true }); // gate disabled → always pass

  const body = await req.json().catch(() => ({}));
  if (!checkPassword(String(body?.password ?? ""))) {
    return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
