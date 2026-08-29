import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * The way in: the browser is sent to Fides ID and comes back with a code.
 *
 * OpenID Connect authorization code flow with PKCE. Unlike Atlas and Lens, this
 * app has no Cortex behind it to verify the token, so it VERIFIES IT ITSELF —
 * signature against the provider's published keys, issuer, audience, expiry.
 * That is the one piece of code not worth hand-rolling eighteen times, so it is
 * `jose` doing it and not a homemade RS256.
 *
 * WHO MAY ENTER is not decided here and not in this app's config. The provider
 * states it, as a role on this client, and this file only reads it. That is the
 * point of one place to administer people: access is granted once, and every
 * app downstream obeys — including when it is taken away.
 */

/** The provider, as the BROWSER knows it. Also the `iss` every token must carry. */
const ISSUER = () => (process.env.FIDES_ISSUER || "").replace(/\/$/, "");
/**
 * The provider, as THIS CONTAINER reaches it — which is not the same address.
 *
 * The fleet's public hostnames are served by an edge whose certificate comes
 * from a private CA that no container trusts, so a server-side fetch to the
 * public https address fails the handshake — at a login screen, one person at a
 * time. The platform injects a plain-HTTP mesh address for a linked provider,
 * and FIDES_BACKCHANNEL_FROM names the variable holding it.
 *
 * Only the BACK-channel calls move: discovery, the token exchange and the keys.
 * The authorize URL stays public (the browser has to reach it), and `iss` stays
 * public — comparing it against the mesh address is the classic way to make
 * every single login fail validation.
 */
const BACKCHANNEL = () =>
  (process.env[process.env.FIDES_BACKCHANNEL_FROM ?? ""] || "").replace(/\/$/, "");
const CLIENT_ID = () => process.env.FIDES_CLIENT_ID || "legacy-ops";
export const PROVIDER_NAME = () => process.env.FIDES_NAME || "Fides ID";
const PUBLIC_URL = () => (process.env.FIDES_PUBLIC_URL || "").replace(/\/$/, "");

/** Must match a redirectUri registered on the client, exactly. */
export const redirectUri = () => `${PUBLIC_URL()}/api/auth/callback`;

/**
 * A URL on THIS app, as the browser knows it.
 *
 * Never `new URL(pfad, req.url)`. Behind the fleet's edge, `req.url` is the
 * address the CONTAINER was reached on — http://localhost:3000 — so a redirect
 * built from it sends the person to their own machine after signing in. It
 * looks perfectly fine in development, where the two happen to be the same,
 * which is exactly why it survived sixteen copies of this file.
 *
 * Falls back to req.url only when nothing else is configured, so running this
 * outside the fleet still works.
 */
export function onPublicUrl(path: string, fallback: string): URL {
  return new URL(path, PUBLIC_URL() || fallback);
}

/** Is this app served over https, as the BROWSER sees it? Same trap: the
 *  connection reaching the container is plain http behind the edge, so asking
 *  the request would leave the session cookie un-secured in production. */
export function servedSecurely(): boolean {
  return PUBLIC_URL().startsWith("https:");
}

/** Swap a public endpoint's origin for the mesh one, keeping its path. */
function onBackchannel(endpoint: string): string {
  const base = BACKCHANNEL();
  if (!base) return endpoint;
  const from = new URL(endpoint);
  const to = new URL(base);
  from.protocol = to.protocol;
  from.host = to.host;
  return from.toString();
}

interface Discovery {
  issuer: string;
  authorize: string;
  token: string;
  jwks: string;
}

let discovered: Discovery | null = null;

/**
 * Read the provider's own description of itself rather than assembling paths.
 *
 * The trailing slash matters: URL() normalises an origin with no path to
 * "https://host/", and appending to that yields "//.well-known/…", which a
 * provider answers with a plain 404 and no hint as to why.
 */
async function config(): Promise<Discovery> {
  if (discovered) return discovered;
  const issuer = ISSUER();
  if (!issuer) throw new Error("Kein Anmeldedienst eingerichtet (FIDES_ISSUER fehlt).");
  const url = `${onBackchannel(issuer).replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Der Anmeldedienst antwortete ${res.status} auf die Konfiguration.`);
  const doc = (await res.json()) as Record<string, string>;
  if (doc.issuer !== issuer) {
    // Refusing here turns a silent misconfiguration into one line in the log,
    // instead of every login failing later with "bad signature".
    throw new Error(`Anmeldedienst nennt sich ${doc.issuer}, erwartet war ${issuer}.`);
  }
  discovered = {
    issuer,
    authorize: doc.authorization_endpoint!,
    token: onBackchannel(doc.token_endpoint!),
    jwks: onBackchannel(doc.jwks_uri!),
  };
  return discovered;
}

let keys: ReturnType<typeof createRemoteJWKSet> | null = null;
async function keySet() {
  if (!keys) keys = createRemoteJWKSet(new URL((await config()).jwks));
  return keys;
}

export interface Attempt {
  state: string;
  nonce: string;
  verifier: string;
}

/** What to remember while the browser is away, and where to send it. */
export async function begin(): Promise<{ url: string; attempt: Attempt }> {
  const { authorize } = await config();
  const attempt: Attempt = {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
  };
  const url = new URL(authorize);
  url.searchParams.set("client_id", CLIENT_ID());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", attempt.state);
  url.searchParams.set("nonce", attempt.nonce);
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(attempt.verifier).digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), attempt };
}

export interface Identity {
  sub: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Turn the code the browser brought back into a person we are willing to admit.
 *
 * Every check below kills one way the login could otherwise be forged: a token
 * signed by a different realm, one minted for another client and replayed here,
 * an expired one, one captured from an earlier login of the same person, or an
 * unsigned one — `jose` refuses `alg: none` and anything outside the list.
 */
export async function complete(
  code: string,
  attempt: Attempt,
): Promise<Identity | { error: string; status: number }> {
  let tokens: Record<string, string>;
  try {
    const { token } = await config();
    const res = await fetch(token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID(),
        code_verifier: attempt.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `${PROVIDER_NAME()} hat den Code abgelehnt.`, status: 502 };
    tokens = (await res.json()) as Record<string, string>;
  } catch (err) {
    console.error("[auth] Anmeldedienst nicht erreichbar:", err);
    return { error: `${PROVIDER_NAME()} ist gerade nicht erreichbar.`, status: 502 };
  }

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(String(tokens.id_token ?? ""), await keySet(), {
      issuer: (await config()).issuer,
      audience: CLIENT_ID(),
      algorithms: ["RS256", "ES256", "PS256"],
      clockTolerance: 60,
    });
    claims = payload as Record<string, unknown>;
  } catch (err) {
    console.warn("[auth] Kennung abgelehnt:", err instanceof Error ? err.message : err);
    return { error: "Die Kennung war nicht gültig.", status: 401 };
  }
  if (claims.nonce !== attempt.nonce) {
    return { error: "Die Kennung gehört zu einer anderen Anmeldung.", status: 401 };
  }

  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Ohne E-Mail-Adresse lässt sich nichts verknüpfen.", status: 502 };
  // An unverified address is not an identity: anybody able to register an
  // account claiming somebody else's address would inherit their place.
  if (claims.email_verified === false) {
    return { error: "Der Anbieter hat diese Adresse nicht bestätigt.", status: 401 };
  }

  const granted = (claims.resource_access as Record<string, { roles?: string[] }> | undefined)?.[
    CLIENT_ID()
  ]?.roles;
  const spelled = new Set((granted ?? []).map((r) => String(r).trim().toLowerCase()));
  const role = spelled.has("admin") ? "admin" : spelled.has("member") ? "member" : "";
  if (!role) {
    // Identity is settled; ACCESS is a separate question, and the provider
    // answers it. Signing in somewhere is not thereby membership here.
    return { error: "Für diesen Bereich noch nicht freigeschaltet.", status: 403 };
  }

  return {
    sub: String(claims.sub),
    email,
    name: String(claims.name ?? "").trim() || email.split("@")[0]!,
    role,
  };
}
