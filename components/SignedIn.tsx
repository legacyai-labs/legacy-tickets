import { currentUser } from "@/lib/guard";

/**
 * Who is signed in, and the way out — small, in a corner, on every page.
 *
 * Since ADR-0014 these apps know a NAME. Not showing it would waste the one
 * thing the migration actually gained for the people using them: before, every
 * session was "somebody who knew the password", and there was nothing to
 * display and nothing to sign out of.
 *
 * A server component, so the identity never travels to the browser as data —
 * it is rendered and gone. Renders NOTHING when nobody is signed in, which is
 * what keeps it out of the way on /login.
 *
 * Mono, small, widely tracked: the Legacy signature, same as the wordmarks.
 */
export async function SignedIn() {
  const who = await currentUser();
  if (!who) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-50 flex items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-muted-foreground">
      <span className="pointer-events-auto max-w-[46vw] truncate" title={who.email}>
        {who.name || who.email}
      </span>
      <form action="/api/auth/logout" method="post" className="pointer-events-auto">
        <button
          type="submit"
          className="uppercase tracking-[0.14em] underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          abmelden
        </button>
      </form>
    </div>
  );
}
