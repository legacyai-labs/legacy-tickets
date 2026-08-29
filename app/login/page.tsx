import { KeystoneGlyph } from "@/components/Keystone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { issuerConfigured } from "@/lib/auth";
import { PROVIDER_NAME } from "@/lib/fides";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ready = issuerConfigured();

  return (
    <main
      className="flex min-h-[100dvh] items-center justify-center p-6"
      style={{ background: "radial-gradient(circle at 50% 30%, hsl(var(--glow)), hsl(var(--background)))" }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-7 flex flex-col items-center text-center">
          <ThemeToggle className="mb-4 grid h-14 w-14 place-items-center rounded-lg">
            <KeystoneGlyph size={40} />
          </ThemeToggle>
          <div className="text-lg font-extrabold tracking-wide" style={{ fontFamily: '"Archivo", sans-serif' }}>
            LEGACY<span className="font-semibold text-muted-foreground">&nbsp;AI</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Tickets
          </div>
        </div>

        <div className="space-y-4">
          {error && <p className="text-sm leading-relaxed text-destructive">{error}</p>}

          {ready ? (
            <Button asChild className="w-full">
              <a href="/api/auth/start">Mit {PROVIDER_NAME()} anmelden</a>
            </Button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Für diesen Bereich ist kein Anmeldedienst eingerichtet.
            </p>
          )}
        </div>

        {/* Whose login this is, said quietly and only where somebody is about to
            type a password. Recognising the name here is what makes landing on
            id.fidesid.com feel expected rather than like a redirect somewhere
            strange. */}
        <p className="mt-8 text-center text-[0.7rem] text-muted-foreground">
          Anmeldung über{" "}
          <a
            href="https://fidesid.com"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Fides&nbsp;ID
          </a>
        </p>
      </div>
    </main>
  );
}
