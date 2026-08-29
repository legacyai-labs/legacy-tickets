/**
 * THE COOKIE — the part of this migration that can actually be attacked.
 *
 * The old cookie was a constant: sha256(password|salt), the same bytes for
 * everybody, asserting only "somebody knew the password". The new one names a
 * person. An unsigned identity cookie is a self-service admin panel, so these
 * tests exist to make sure it stays signed, stays fresh, and stays worthless
 * without the secret.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open, seal, SESSION_TTL_SECONDS, type Session } from "../lib/session";

const SECRET = "a-secret-only-this-app-has";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.FIDES_SESSION_SECRET;
  process.env.FIDES_SESSION_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.FIDES_SESSION_SECRET;
  else process.env.FIDES_SESSION_SECRET = saved;
});

const luis = (): Session => ({
  sub: "sub-1",
  email: "luis@beispiel.de",
  name: "Luis Dehlwes",
  exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
});

describe("the session cookie", () => {
  it("round-trips who it is about", () => {
    const session = open(seal(luis()));
    expect(session).toMatchObject({ sub: "sub-1", email: "luis@beispiel.de", name: "Luis Dehlwes" });
  });

  it("REFUSES a payload edited in the browser — the whole point of signing it", () => {
    const [payload] = seal(luis()).split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    forged.email = "chef@beispiel.de";
    const swapped = Buffer.from(JSON.stringify(forged)).toString("base64url");
    // Same signature, different payload — and a nice try with no signature.
    expect(open(`${swapped}.${seal(luis()).split(".")[1]}`)).toBeNull();
    expect(open(swapped)).toBeNull();
  });

  it("refuses a signature from a DIFFERENT secret", () => {
    const cookie = seal(luis());
    process.env.FIDES_SESSION_SECRET = "somebody-elses-secret";
    expect(open(cookie)).toBeNull();
  });

  it("refuses an expired session", () => {
    expect(open(seal({ ...luis(), exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
  });

  it("FAILS CLOSED without a secret: nothing can be issued, nothing accepted", () => {
    const cookie = seal(luis());
    delete process.env.FIDES_SESSION_SECRET;
    expect(open(cookie)).toBeNull();
    expect(() => seal(luis())).toThrow();
  });

  it("refuses rubbish rather than throwing at it", () => {
    for (const junk of ["", "no-dot", ".", "a.b", "....", "x".repeat(500)]) {
      expect(open(junk)).toBeNull();
    }
    expect(open(undefined)).toBeNull();
  });
});
