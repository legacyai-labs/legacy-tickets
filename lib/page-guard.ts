import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE } from "./auth";
import { open } from "./session";

/**
 * Server-side page gate: to /login unless a valid session is presented.
 *
 * NO "gate off" short-circuit any more. This used to return early when no
 * password was configured, which meant the studio was public exactly when
 * somebody had forgotten to fill in an env var — and whether the door stood
 * open came down to luck rather than to a decision. The same trap cost Atlas a
 * whole card list once.
 *
 * Now a missing secret means nobody gets in, and /login says why. That is the
 * loud failure: an app that refuses everyone gets fixed within the hour, an app
 * that admits everyone can stay that way for months.
 */
export async function ensureAuthed(): Promise<void> {
  const jar = await cookies();
  if (open(jar.get(AUTH_COOKIE)?.value)) return;
  redirect("/login");
}
