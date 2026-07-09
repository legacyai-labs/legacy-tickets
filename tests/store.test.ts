import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_FILENAME, TicketsStore, parseState } from "../lib/tickets/store";
import type { Ticket, TicketsState } from "../lib/tickets/model";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "legacy-tickets-test-"));
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    ref: "TCK-001",
    kind: "bug",
    title: "T",
    body: "b",
    status: "open",
    priority: "medium",
    labels: [],
    reporter: "human",
    origin: "manual",
    activity: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("TicketsStore", () => {
  it("round-trips tickets + counter through the JSON file", () => {
    const dir = tempDir();
    const a = new TicketsStore(dir);
    const state: TicketsState = {
      tickets: [makeTicket({ id: "x", title: "Persistiert" })],
      counter: 7,
    };
    a.save(state);

    const b = new TicketsStore(dir); // fresh instance reads from disk
    const loaded = b.load();
    expect(loaded.tickets).toHaveLength(1);
    expect(loaded.tickets[0]!.title).toBe("Persistiert");
    expect(loaded.counter).toBe(7); // the ref counter survives restarts
  });

  it("load() returns a defensive copy — mutations don't leak back", () => {
    const dir = tempDir();
    const store = new TicketsStore(dir);
    store.save({ tickets: [makeTicket()], counter: 1 });
    const copy = store.load();
    copy.tickets[0]!.title = "mutiert";
    copy.counter = 99;
    expect(store.load().tickets[0]!.title).toBe("T");
    expect(store.load().counter).toBe(1);
  });

  it("MIGRATION-SAFE: derives the counter from the highest ref when it is missing", () => {
    const dir = tempDir();
    const old = {
      tickets: [
        makeTicket({ id: "a", ref: "TCK-003" }),
        makeTicket({ id: "b", ref: "TCK-011" }),
      ],
      // no counter — an older writer
    };
    writeFileSync(join(dir, STORE_FILENAME), JSON.stringify(old), "utf8");

    const store = new TicketsStore(dir);
    expect(store.load().counter).toBe(11); // next ticket becomes TCK-012
    expect(store.load().tickets).toHaveLength(2);
  });

  it("MIGRATION-SAFE: backfills missing labels/activity arrays on load", () => {
    const dir = tempDir();
    const bare = {
      tickets: [{ id: "a", ref: "TCK-001", kind: "bug", title: "alt", body: "", status: "open", priority: "medium", reporter: "human", origin: "manual", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }],
      counter: 1,
    };
    writeFileSync(join(dir, STORE_FILENAME), JSON.stringify(bare), "utf8");

    const t = new TicketsStore(dir).load().tickets[0]!;
    expect(t.labels).toEqual([]);
    expect(t.activity).toEqual([]);
  });

  it("reading alone never rewrites the file — the normalised shape lands on the next save", () => {
    const dir = tempDir();
    const file = join(dir, STORE_FILENAME);
    writeFileSync(file, JSON.stringify({ tickets: [makeTicket({ ref: "TCK-005" })] }), "utf8");

    const store = new TicketsStore(dir);
    expect(JSON.parse(readFileSync(file, "utf8")).counter).toBeUndefined(); // untouched by the read

    store.save(store.load());
    expect(JSON.parse(readFileSync(file, "utf8")).counter).toBe(5);
  });

  it("never throws on a corrupt file — falls back to an empty in-memory state", () => {
    const dir = tempDir();
    writeFileSync(join(dir, STORE_FILENAME), "{ kaputt", "utf8");
    const store = new TicketsStore(dir);
    expect(store.load()).toEqual({ tickets: [], counter: 0 });
    expect(store.isPersistent).toBe(false);
    // saving still works (in-memory)
    const saved = store.save({ tickets: [makeTicket()], counter: 1 });
    expect(saved.tickets).toHaveLength(1);
  });
});

describe("parseState", () => {
  it("passes the current shape through and tolerates junk", () => {
    expect(parseState(null)).toEqual({ tickets: [], counter: 0 });
    expect(parseState("x")).toEqual({ tickets: [], counter: 0 });
    expect(parseState({})).toEqual({ tickets: [], counter: 0 });
    expect(parseState({ tickets: "nope", counter: "nan" })).toEqual({ tickets: [], counter: 0 });
    const state = { tickets: [makeTicket()], counter: 3 };
    expect(parseState(state)).toEqual(state);
  });

  it("never lets a broken counter fall below the highest ref (monotonic refs)", () => {
    const state = parseState({ tickets: [makeTicket({ ref: "TCK-009" })], counter: 2 });
    expect(state.counter).toBe(9); // a stale counter would mint duplicate refs
  });

  it("drops non-object junk from the tickets array", () => {
    const state = parseState({ tickets: [makeTicket(), null, "junk", 42], counter: 1 });
    expect(state.tickets).toHaveLength(1);
  });
});
