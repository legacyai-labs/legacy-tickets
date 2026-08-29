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
const CLIENT = "legacy-ops";
/**
 * The address the BROWSER knows, deliberately NOT the one the app is reached on.
 *
 * They were the same here until now, and that is precisely why sixteen copies
 * of the callback could redirect to `req.url` — the container's own address —
 * and look perfectly correct in every test. In production that address is
 * localhost, and people landed on their own machine after signing in. Keeping
 * the two apart is what makes the difference visible.
 */
const OEFFENTLICH = "https://tickets.example.test";
/** Follow a redirect meant for the browser, on the app we actually started. */
const nachInnen = (url) => String(url).replace(OEFFENTLICH, base);

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
  laufend = app;
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


/**
 * Whatever is running, so a crash does not leave it behind.
 *
 * Without this, a script that throws half-way keeps its server alive on the
 * port — and the NEXT repository's run then refuses to start, or worse, would
 * have measured that leftover. One failure would stall a whole fleet sweep.
 */
let laufend = null;
const aufraeumen = () => {
  if (laufend) stoppen(laufend);
  laufend = null;
};
process.on("exit", aufraeumen);
process.on("uncaughtException", (err) => {
  console.error(err);
  aufraeumen();
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(err);
  aufraeumen();
  process.exit(1);
});

/** The whole process group, not just the wrapper. */
function stoppen(app) {
  try {
    process.kill(-app.pid, "SIGTERM");
  } catch {
    try { app.kill(); } catch { /* schon weg */ }
  }
}

const base = `http://127.0.0.1:${PORT}`;
/** Die Seite, die wirklich hinter dem Waechter liegt. */
const SEITE = "/board";
/** So heisst der Sitzungs-Keks in DIESEM Repo. */
const KEKS = "legacy_auth=";
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
  FIDES_PUBLIC_URL: OEFFENTLICH,
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
const guarded = await fetch(`${base}${SEITE}`, { redirect: "manual" });
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
const callback = await fetch(nachInnen(authorized.headers.get("location")), {
  redirect: "manual",
  headers: { cookie: jar },
});
const session = (callback.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(KEKS));
// The bug that reached production: built from req.url, this said
// http://localhost:3000 and sent people to their own machine.
check("the redirect after signing in points at the PUBLIC address, not the container's",
  (callback.headers.get("location") ?? "").startsWith(OEFFENTLICH),
  callback.headers.get("location"));
check("…and the session cookie is marked Secure, from the public scheme",
  /secure/i.test(session ?? ""), String(session));
check("the callback lands in the studio with a session",
  [302, 307].includes(callback.status) &&
  (callback.headers.get("location") ?? "").includes(SEITE) && Boolean(session),
  `status=${callback.status} to=${callback.headers.get("location")}`);
check("…httpOnly, so no script can read the identity", /httponly/i.test(session ?? ""), String(session));

const sessionJar = (session ?? "").split(";")[0];
const asPerson = await fetch(`${base}${SEITE}`, { headers: { cookie: sessionJar }, redirect: "manual" });
check("/studio with the session → through", asPerson.status === 200, `status=${asPerson.status}`);
const apiAsPerson = await api({ cookie: sessionJar });
check("…and so is the API, under the person's own cookie", durch(apiAsPerson), `status=${apiAsPerson.status}`);

// The one thing this migration actually gained for the people using the app:
// it knows a NAME now. Before, every session was "somebody who knew the
// password" and there was nothing to show. If it is not on the page, the name
// travelled all the way from Fides and got dropped at the last step.
const seite = await (await fetch(`${base}${SEITE}`, { headers: { cookie: sessionJar } })).text();
check("the page says WHO is signed in", seite.includes("Luis Dehlwes"),
  "der Name steht nicht im HTML");

// And a name you cannot put down is a problem on a shared machine.
const raus = await fetch(`${base}/api/auth/logout`, {
  method: "POST", headers: { cookie: sessionJar }, redirect: "manual",
});
const geloescht = (raus.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(KEKS));
check("signing out clears the session and returns to /login",
  [302, 303, 307].includes(raus.status) &&
  (raus.headers.get("location") ?? "").includes("/login") &&
  /max-age=0|expires=thu, 01 jan 1970/i.test(geloescht ?? ""),
  `status=${raus.status} cookie=${geloescht}`);

// --- 3. the forgeries --------------------------------------------------------
console.log("\n3. What must not get in:");
const tampered = sessionJar.replace(/=([^.]+)\./, (_m, p) =>
  `=${Buffer.from(JSON.stringify({ sub: "x", email: "chef@beispiel.de", name: "Chef", exp: 2 ** 31 })).toString("base64url")}.`);
const forged = await fetch(`${base}${SEITE}`, { headers: { cookie: tampered }, redirect: "manual" });
check("a payload edited in the browser → back to /login",
  [302, 307].includes(forged.status), `status=${forged.status}`);

const noState = await fetch(`${base}/api/auth/callback?code=the-code&state=never-issued`, {
  redirect: "manual", headers: { cookie: jar },
});
check("a state we never issued → /login with an error, never a session",
  (noState.headers.get("location") ?? "").includes("error=") &&
  !(noState.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(KEKS)),
  noState.headers.get("location"));

// Access is the provider's decision, not ours: no role on this client, no entry.
idp.respondWith(({ nonce, sign, claimsFor }) => ({ id_token: sign(claimsFor({ nonce, roles: [] })) }));
const started2 = await fetch(`${base}/api/auth/start`, { redirect: "manual" });
const jar2 = ((started2.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth_flow=")) ?? "").split(";")[0];
const auth2 = await fetch(new URL(started2.headers.get("location")), { redirect: "manual" });
const denied = await fetch(nachInnen(auth2.headers.get("location")), { redirect: "manual", headers: { cookie: jar2 } });
check("a person with no role for this client is turned away",
  (denied.headers.get("location") ?? "").includes("error=") &&
  !(denied.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(KEKS)),
  denied.headers.get("location"));

// An unsigned token is the oldest trick there is.
idp.respondWith(({ nonce, sign, claimsFor }) => ({ id_token: sign(claimsFor({ nonce }), { alg: "none" }) }));
const started3 = await fetch(`${base}/api/auth/start`, { redirect: "manual" });
const jar3 = ((started3.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("legacy_auth_flow=")) ?? "").split(";")[0];
const auth3 = await fetch(new URL(started3.headers.get("location")), { redirect: "manual" });
const unsigned = await fetch(nachInnen(auth3.headers.get("location")), { redirect: "manual", headers: { cookie: jar3 } });
check("an UNSIGNED token is refused",
  !(unsigned.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(KEKS)),
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
const shutStudio = await fetch(`${base}${SEITE}`, { redirect: "manual" });
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
