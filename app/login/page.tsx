"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeystoneGlyph } from "@/components/Keystone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogIn } from "lucide-react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Anmeldung fehlgeschlagen.");
        setBusy(false);
        return;
      }
      router.replace("/board");
      router.refresh();
    } catch {
      setError("Netzwerkfehler.");
      setBusy(false);
    }
  }

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

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">Passwort</Label>
            <Input
              id="pw"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? "Anmelden…" : "Anmelden"}
          </Button>
        </form>
      </div>
    </main>
  );
}
