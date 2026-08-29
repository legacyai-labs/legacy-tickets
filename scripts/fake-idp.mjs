/**
 * A stand-in Fides ID that really signs, and really has two addresses.
 *
 * Unlike Atlas and Lens, this app verifies the ID token itself — so a fake that
 * hands out an unsigned string would prove nothing. This one holds a real RSA
 * key, publishes real JWKS, and can be asked to misbehave.
 *
 * And it listens TWICE. The public address answers only `authorize`; discovery,
 * the token exchange and the keys live on the mesh address alone. In production
 * the public hostname is served by an edge whose certificate no container
 * trusts, so a back-channel call that forgot to move gets a 599 here instead of
 * a TLS error in six weeks.
 */
import { createServer } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";

const REALM = "/realms/fides";
const KID = "test-key";

export async function startFakeIdp({ clientId = "legacy-studio" } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" };
  let publicUrl = "";
  const authorizations = [];
  /** What the next exchange returns; replaced per test. */
  let mint = null;

  const sign = (claims, { alg = "RS256", corrupt = false } = {}) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b64({ alg, kid: KID, typ: "JWT" });
    const body = b64(claims);
    if (alg === "none") return `${head}.${body}.`;
    const mac = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
    return `${head}.${body}.${corrupt ? `${mac.slice(0, -4)}AAAA` : mac}`;
  };

  const claimsFor = ({ nonce, roles = ["member"], email = "luis@beispiel.de", name = "Luis Dehlwes" }) => ({
    iss: `${publicUrl}${REALM}`,
    aud: clientId,
    azp: clientId,
    sub: `sub-${email}`,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce,
    email,
    email_verified: true,
    name,
    resource_access: { [clientId]: { roles } },
  });

  const answer = (res, code, payload) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const handler = (reachable) => (req, res) => {
    const url = new URL(req.url ?? "/", "http://idp.invalid");
    const path = url.pathname.replace(REALM, "");

    if (path === "/protocol/openid-connect/auth") {
      const query = Object.fromEntries(url.searchParams);
      authorizations.push(query);
      const back = new URL(String(query.redirect_uri));
      back.searchParams.set("code", "the-code");
      back.searchParams.set("state", String(query.state ?? ""));
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (!reachable) {
      answer(res, 599, { error: "auf der oeffentlichen Adresse scheitert der Handshake" });
      return;
    }
    if (path === "/.well-known/openid-configuration") {
      return answer(res, 200, {
        issuer: `${publicUrl}${REALM}`,
        authorization_endpoint: `${publicUrl}${REALM}/protocol/openid-connect/auth`,
        token_endpoint: `${publicUrl}${REALM}/protocol/openid-connect/token`,
        jwks_uri: `${publicUrl}${REALM}/protocol/openid-connect/certs`,
      });
    }
    if (path === "/protocol/openid-connect/certs") return answer(res, 200, { keys: [jwk] });
    if (path === "/protocol/openid-connect/token") {
      req.resume();
      req.on("end", () => {
        const nonce = authorizations.at(-1)?.nonce;
        answer(res, 200, mint ? mint({ nonce, sign, claimsFor }) : { id_token: sign(claimsFor({ nonce })) });
      });
      return;
    }
    return answer(res, 404, {});
  };

  const publicSide = createServer(handler(false));
  const meshSide = createServer(handler(true));
  await new Promise((ok) => publicSide.listen(0, "127.0.0.1", ok));
  await new Promise((ok) => meshSide.listen(0, "127.0.0.1", ok));
  publicUrl = `http://127.0.0.1:${publicSide.address().port}`;

  return {
    issuer: `${publicUrl}${REALM}`,
    mesh: `http://127.0.0.1:${meshSide.address().port}`,
    authorizations,
    /** Decide what the next exchange returns — used to forge and to misbehave. */
    respondWith(next) {
      mint = next;
    },
    normal() {
      mint = null;
    },
    close() {
      publicSide.close();
      meshSide.close();
    },
  };
}
