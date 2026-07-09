// Tiny JSON file store for the ticket board.
//
// Backed by (TICKETS_DATA_DIR ?? DATA_DIR ?? "/data")/legacy-tickets.json.
// NEVER throws on a missing/corrupt file or dir: it falls back to an in-memory
// empty state so the app also runs with no volume mounted (local dev, CI).
//
// MIGRATION-SAFE LOADER: whatever is on disk is normalised into the current
// { tickets, counter } shape. A file without a counter (or with a broken one)
// derives it from the highest TCK-xxx ref so new refs stay monotonic; missing
// list fields (labels, activity) are backfilled. Reading alone never rewrites
// the file — the normalised shape is persisted on the NEXT save.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyState, type Ticket, type TicketsState } from "./model";

export function resolveDataDir(): string {
  return process.env.TICKETS_DATA_DIR ?? process.env.DATA_DIR ?? "/data";
}

export const STORE_FILENAME = "legacy-tickets.json";

// ---------------------------------------------------------------------------
// Migration-safe parsing
// ---------------------------------------------------------------------------

/** Number of a "TCK-042"-style ref, 0 when it doesn't parse. */
function refNumber(ref: unknown): number {
  if (typeof ref !== "string") return 0;
  const m = /^TCK-(\d+)$/.exec(ref);
  return m ? Number(m[1]) : 0;
}

/** Backfill list fields older writers might have omitted. */
function normalizeTicket(raw: Record<string, unknown>): Ticket {
  const t = raw as unknown as Ticket;
  if (!Array.isArray(t.labels)) t.labels = [];
  if (!Array.isArray(t.activity)) t.activity = [];
  return t;
}

/**
 * Parse whatever is on disk into the CURRENT state shape. Tolerates junk
 * (→ empty state) and a missing/invalid counter (→ derived from the highest
 * ref, so the next created ticket still gets a fresh monotonic ref).
 */
export function parseState(parsed: unknown): TicketsState {
  if (!parsed || typeof parsed !== "object") return emptyState();
  const obj = parsed as Record<string, unknown>;

  const tickets = Array.isArray(obj.tickets)
    ? (obj.tickets as unknown[])
        .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
        .map(normalizeTicket)
    : [];

  const derived = tickets.reduce((max, t) => Math.max(max, refNumber(t.ref)), 0);
  const counter =
    typeof obj.counter === "number" && Number.isInteger(obj.counter) && obj.counter >= derived
      ? obj.counter
      : derived;

  return { tickets, counter };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class TicketsStore {
  private state: TicketsState;
  private readonly dir: string;
  private readonly file: string;
  /** true once we've confirmed we can read/write the file (else in-memory only). */
  private persistent = false;

  constructor(dir: string = resolveDataDir()) {
    this.dir = dir;
    this.file = join(dir, STORE_FILENAME);
    this.state = emptyState();
    try {
      if (existsSync(this.file)) {
        const raw = readFileSync(this.file, "utf8");
        this.state = parseState(JSON.parse(raw)); // normalises older shapes in memory
        this.persistent = true; // normalised shape hits the disk on the NEXT save
      } else {
        this.trySeed();
      }
    } catch {
      // Corrupt or unreadable file — keep an empty state, stay in-memory.
      this.state = emptyState();
      this.persistent = false;
    }
  }

  private trySeed(): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
      this.persistent = true;
    } catch {
      this.persistent = false; // no volume / not writable -> in-memory only
    }
  }

  get isPersistent(): boolean {
    return this.persistent;
  }

  /** Return a defensive deep copy so callers can't mutate internal state. */
  load(): TicketsState {
    return structuredClone(this.state);
  }

  /** Replace the whole state and best-effort persist. Never throws. */
  save(next: TicketsState): TicketsState {
    this.state = next;
    if (this.persistent) {
      try {
        if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
      } catch {
        this.persistent = false; // volume vanished — degrade to in-memory
      }
    }
    return this.load();
  }
}

// One store per server process; kept on globalThis so Next.js dev hot-reload
// (which re-evaluates modules) doesn't fork the in-memory state.
const g = globalThis as typeof globalThis & { __ticketsStore?: TicketsStore };

export function getStore(): TicketsStore {
  if (!g.__ticketsStore) g.__ticketsStore = new TicketsStore();
  return g.__ticketsStore;
}
