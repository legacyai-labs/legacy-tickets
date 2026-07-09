import { createHash } from "node:crypto";

// Password-only gate for the board. Enabled when STUDIO_PASSWORD is set (runtime
// env — read server-side, no build-time baking). The cookie stores a hash of the
// password so changing it invalidates old sessions; nothing reversible is stored.
const PASSWORD = process.env.STUDIO_PASSWORD || "";
export const AUTH_COOKIE = "legacy_auth";

export function authEnabled(): boolean {
  return PASSWORD.length > 0;
}

export function expectedToken(): string {
  return createHash("sha256").update(`${PASSWORD}|legacy-design-studio`).digest("hex");
}

export function checkPassword(input: string): boolean {
  return authEnabled() && input === PASSWORD;
}
