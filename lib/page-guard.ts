import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, authEnabled, expectedToken } from "./auth";

/** Server-side page gate: redirect to /login unless authed (or the gate is off). */
export async function ensureAuthed(): Promise<void> {
  if (!authEnabled()) return;
  const jar = await cookies();
  if (jar.get(AUTH_COOKIE)?.value !== expectedToken()) redirect("/login");
}
