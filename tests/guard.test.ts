import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { kindOf, serviceAuthed, type HeaderCarrier } from "../lib/guard";

function req(headers: Record<string, string>): HeaderCarrier {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name) => map.get(name.toLowerCase()) ?? null } };
}

const ENV_KEYS = ["TICKETS_TOKEN", "TICKETS_API_TOKEN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("serviceAuthed", () => {
  it("accepts x-tickets-token when it matches TICKETS_TOKEN", () => {
    process.env.TICKETS_TOKEN = "secret-a";
    expect(serviceAuthed(req({ "x-tickets-token": "secret-a" }))).toBe(true);
    expect(serviceAuthed(req({ "x-tickets-token": "wrong" }))).toBe(false);
  });

  it("accepts Authorization: Bearer <TICKETS_API_TOKEN> (nexus gateway)", () => {
    process.env.TICKETS_API_TOKEN = "secret-b";
    expect(serviceAuthed(req({ authorization: "Bearer secret-b" }))).toBe(true);
    expect(serviceAuthed(req({ authorization: "Bearer nope" }))).toBe(false);
    expect(serviceAuthed(req({ authorization: "secret-b" }))).toBe(false); // scheme required
  });

  it("FAILS CLOSED: no tokens configured -> nothing authenticates", () => {
    expect(serviceAuthed(req({ "x-tickets-token": "anything" }))).toBe(false);
    expect(serviceAuthed(req({ authorization: "Bearer anything" }))).toBe(false);
    expect(serviceAuthed(req({}))).toBe(false);
  });
});

describe("kindOf (authKind precedence)", () => {
  it("service token wins, then the human cookie, else null", () => {
    expect(kindOf(true, false)).toBe("service");
    expect(kindOf(true, true)).toBe("service");
    expect(kindOf(false, true)).toBe("human");
    expect(kindOf(false, false)).toBeNull();
  });
});
