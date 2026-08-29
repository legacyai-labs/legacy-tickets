/**
 * Who may reach the studio — checked against the RUNNING app.
 *
 * Two audiences share this door and must not be confused: a PERSON, who now
 * signs in at Fides ID, and a MACHINE (Autopilot, the gateway), which presents
 * a service token and has never had a cookie. The migration touched only the
 * first. These checks exist to prove it left the second alone, because that is
 * what would break silently and be noticed by a pipeline, not by a human.
 *
 * The fake provider serves discovery, keys and the token exchange ONLY on its
 * mesh address — a back-channel call left on the public hostname fails here
 * rather than on a certificate in production.
 *
 *   node scripts/check-auth.mjs        (npm run check:auth)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "./fake-idp.mjs";

const PORT = 5391;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SERVICE_TOKEN = "autopilot-service-token";
const SECRET = "the-signing-secret";
const CLIENT = "legacy-studio";

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
};

const idp = await startFakeIdp({ clientId: CLIENT });

/**
 * Start the app — and refuse to run against somebody else's.
 *
 * `next start` spawns a child of its own, so killing the npx wrapper can leave
 * a server holding the port. The next run then talks to THAT one and reports
 * cheerfully on an app it never started. A whole fleet was nearly measured
 * against one satellite this way. So: own process group, killed as a group, and
 * a port that must be free before we begin.
 */
async function frei() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(1000) });
    return false; // somebody answered — not ours
  } catch {
    return true;
  }
}

async function start(env) {
  if (!(await frei())) {
    throw new Error(`Port ${PORT} ist belegt — ein alter Server läuft noch. Erst beenden.`);
  }
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", ...env },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fetch(`http://127.0.0.1:${PORT}/login`);
      return app;
    } catch {
      /* not up yet */
    }
  }
  throw new Error("die App kam nicht hoch");
}


/** The whole process group, not just the wrapper. */
function stoppen(app) {
  try {
    process.kill(-app.pid, "SIGTERM");
  } catch {
    try { app.kill(); } catch { /* schon weg */ }
  }
}

const base = `http://127.0.0.1:${PORT}`;
const API = { pfad: "/api/board", methode: "GET" };
const api = (headers) =>
  fetch(`${base}${API.pfad}`, {
    method: API.methode,
    headers: API.methode === "GET" ? headers : { ...headers, "content-type": "application/json" },
    ...(API.methode === "GET" ? {} : { body: "{}" }),
  });
const FULL = {
  TICKETS_TOKEN: SERVICE_TOKEN,
  FIDES_SESSION_SECRET: SECRET,
  FIDES_ISSUER: idp.issuer,
  FIDES_BACKCHANNEL_FROM: "FIDESID_URL",
  FIDESID_URL: idp.mesh,
  FIDES_CLIENT_ID: CLIENT,
  FIDES_PUBLIC_URL: base,
};

let app = await start(FULL);

// --- 1. the machine, which this migration must not have touched -------------
console.log("\n1. Autopilot and the gateway keep working, with no cookie at all:");
const durch = (r) => r.status !== 401 && r.status !== 403;
const svc = await api({ "x-tickets-token": SERVICE_TOKEN });
check("/api/board with a service token → through", durch(svc), `status=${svc.status}`);
const svcWrong = await api({ "x-tickets-token": "wrong" });
check("…and a wrong one does not", !durch(svcWrong), `status=${svcWrong.status}`);
const naked = await api({});
check("no credential at all → refused", !durch(naked), `status=${naked.status}`);

// --- 2. the person -----------------------------------------------------------
console.log("\n2. A person signs in at the provider:");
const guarded = await fetch(`${base}/board`, { redirect: "manual" });
check("/studio without a session → /login", [302, 307].includes(guarded.status) &&
  (guarded.headers.get("location") ?? "").includes("/login"), `status=${guarded.status}`);

const started = await fetch(`${base}/api/auth/start`, { redirect: "manual" });
const away = new URL(started.headers.get("location") ?? `${base}/nowhere`);
const flowCookie = (started.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth_flow="));
check("/api/auth/start → the provider's PUBLIC authorize endpoint",
  [302, 307].includes(started.status) && away.href.startsWith(`${idp.issuer}/`), `to=${away.href}`);
check("…and the login in flight rides in an httpOnly cookie, not in memory",
  Boolean(flowCookie) && /httponly/i.test(flowCookie ?? ""), String(flowCookie));

const jar = (flowCookie ?? "").split(";")[0];
// Only now does the browser actually arrive at the provider, so only now is
// there anything for it to have recorded.
const authorized = await fetch(away, { redirect: "manual" });
const asked = idp.authorizations.at(-1) ?? {};
check("…with PKCE, a state and this client", asked.code_challenge_method === "S256" &&
  Boolean(asked.code_challenge) && asked.client_id === CLIENT, JSON.stringify(asked));
const callback = await fetch(authorized.headers.get("location"), {
  redirect: "manual",
  headers: { cookie: jar },
});
const session = (callback.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth="));
check("the callback lands in the studio with a session",
  [302, 307].includes(callback.status) &&
  (callback.headers.get("location") ?? "").includes("/board") && Boolean(session),
  `status=${callback.status} to=${callback.headers.get("location")}`);
check("…httpOnly, so no script can read the identity", /httponly/i.test(session ?? ""), String(session));

const sessionJar = (session ?? "").split(";")[0];
const asPerson = await fetch(`${base}/board`, { headers: { cookie: sessionJar }, redirect: "manual" });
check("/studio with the session → through", asPerson.status === 200, `status=${asPerson.status}`);
const apiAsPerson = await api({ cookie: sessionJar });
check("…and so is the API, under the person's own cookie", durch(apiAsPerson), `status=${apiAsPerson.status}`);

// --- 3. the forgeries --------------------------------------------------------
console.log("\n3. What must not get in:");
const tampered = sessionJar.replace(/legacy_auth=([^.]+)\./, (_m, p) =>
  `legacy_auth=${Buffer.from(JSON.stringify({ sub: "x", email: "chef@beispiel.de", name: "Chef", exp: 2 ** 31 })).toString("base64url")}.`);
const forged = await fetch(`${base}/board`, { headers: { cookie: tampered }, redirect: "manual" });
check("a payload edited in the browser → back to /login",
  [302, 307].includes(forged.status), `status=${forged.status}`);

const noState = await fetch(`${base}/api/auth/callback?code=the-code&state=never-issued`, {
  redirect: "manual", headers: { cookie: jar },
});
check("a state we never issued → /login with an error, never a session",
  (noState.headers.get("location") ?? "").includes("error=") &&
  !(noState.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("legacy_auth=")),
  noState.headers.get("location"));

// Access is the provider's decision, not ours: no role on this client, no entry.
idp.respondWith(({ nonce, sign, claimsFor }) => ({ id_token: sign(claimsFor({ nonce, roles: [] })) }));
const started2 = await fetch(`${base}/api/auth/start`, { redirect: "manual" });
const jar2 = ((started2.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth_flow=")) ?? "").split(";")[0];
const auth2 = await fetch(new URL(started2.headers.get("location")), { redirect: "manual" });
const denied = await fetch(auth2.headers.get("location"), { redirect: "manual", headers: { cookie: jar2 } });
check("a person with no role for this client is turned away",
  (denied.headers.get("location") ?? "").includes("error=") &&
  !(denied.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("legacy_auth=")),
  denied.headers.get("location"));

// An unsigned token is the oldest trick there is.
idp.respondWith(({ nonce, sign, claimsFor }) => ({ id_token: sign(claimsFor({ nonce }), { alg: "none" }) }));
const started3 = await fetch(`${base}/api/auth/start`, { redirect: "manual" });
const jar3 = ((started3.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth_flow=")) ?? "").split(";")[0];
const auth3 = await fetch(new URL(started3.headers.get("location")), { redirect: "manual" });
const unsigned = await fetch(auth3.headers.get("location"), { redirect: "manual", headers: { cookie: jar3 } });
check("an UNSIGNED token is refused",
  !(unsigned.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("legacy_auth=")),
  unsigned.headers.get("location"));
idp.normal();

// --- 4. fail closed ----------------------------------------------------------
// The trap this migration replaced: the old page gate let everyone through when
// no password was configured, so the studio was public exactly when somebody had
// forgotten an env var. Whether the door stood open was luck, not a decision.
console.log("\n4. With no signing secret configured, nobody gets in:");
stoppen(app);
await new Promise((r) => setTimeout(r, 1200));
const { FIDES_SESSION_SECRET: _drop, ...ohne } = FULL;
app = await start({ ...ohne, FIDES_SESSION_SECRET: "" });
const shutStudio = await fetch(`${base}/board`, { redirect: "manual" });
check("/studio → /login rather than wide open", [302, 307].includes(shutStudio.status), `status=${shutStudio.status}`);
const shutApi = await api({ cookie: sessionJar });
check("a previously valid cookie no longer opens the API", !durch(shutApi), `status=${shutApi.status}`);
const stillService = await api({ "x-tickets-token": SERVICE_TOKEN });
check("but the service token still works — Autopilot does not depend on the human path",
  durch(stillService), `status=${stillService.status}`);

console.log(`\n${failed === 0 ? "ALL GREEN" : `${failed} FAILURE(S)`}\n`);
stoppen(app);
idp.close();
process.exit(failed === 0 ? 0 : 1);
