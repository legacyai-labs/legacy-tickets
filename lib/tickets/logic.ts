// Pure domain logic for the ticket board — every rule the API routes enforce
// lives here, route-independent and unit-testable without a Next.js server.
//
// The one rule that matters most is THE DELETE BOUNDARY: a service actor
// (Autopilot / gateway token) may file tickets, edit them, comment, triage and
// set ANY status — all of that is internal ops without Aussenwirkung, fully
// auditable in the activity thread, and deliberately open to the AI
// self-optimization loop. What a service actor may NEVER do is DELETE a
// ticket: removal erases memory (including the AI's own protocol), so it is a
// human act in the board UI (403, DELETE_BOUNDARY_ERROR).

import { randomUUID } from "node:crypto";
import {
  formatRef,
  isTicketKind,
  isTicketPriority,
  isTicketSeverity,
  isTicketStatus,
  type Activity,
  type ActivityActor,
  type Ticket,
  type TicketKind,
  type TicketPriority,
  type TicketSeverity,
  type TicketStatus,
  type TicketsState,
} from "./model";

export type Actor = "human" | "service";

/** 403 body when a service actor tries to delete a ticket. */
export const DELETE_BOUNDARY_ERROR = "Loeschen nur durch Menschen im Ticket-Board";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

const err = (
  status: 400 | 403 | 404,
  error: string,
): { ok: false; status: 400 | 403 | 404; error: string } => ({ ok: false, status, error });

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : undefined;

/** The activity label a caller writes under: service tokens are the Autopilot. */
export function activityActor(actor: Actor): ActivityActor {
  return actor === "service" ? "autopilot" : "human";
}

function pushActivity(
  ticket: Ticket,
  actor: ActivityActor,
  kind: Activity["kind"],
  text: string,
  now: string,
  id: string = randomUUID(),
): void {
  ticket.activity.push({ id, ts: now, actor, kind, text });
}

// ---------------------------------------------------------------------------
// Create — POST /api/tickets
// ---------------------------------------------------------------------------

/**
 * Build a new ticket from an untrusted body. Status is ALWAYS "open" on create
 * — any status in the body is deliberately ignored. The ref is assigned from
 * the store's monotonic counter (formatRef(counter + 1)); the caller persists
 * the returned counter. Origin defaults by caller: a service actor files as
 * "autopilot" unless the body says otherwise; a human files as "manual".
 * The birth of the ticket is recorded as an activity of kind "created".
 */
export function createTicket(
  input: Record<string, unknown>,
  actor: Actor,
  counter: number,
  now: string = new Date().toISOString(),
  id: string = randomUUID(),
): Result<{ ticket: Ticket; counter: number }> {
  const title = str(input.title);
  if (!title) return err(400, "title is required (non-empty string)");

  let kind: TicketKind = "task";
  if (input.kind !== undefined) {
    if (!isTicketKind(input.kind)) return err(400, "kind must be one of bug|feature|task|question");
    kind = input.kind;
  }

  let priority: TicketPriority = "medium";
  if (input.priority !== undefined) {
    if (!isTicketPriority(input.priority)) {
      return err(400, "priority must be one of low|medium|high|urgent");
    }
    priority = input.priority;
  }

  if (input.severity !== undefined && input.severity !== null && input.severity !== "") {
    if (!isTicketSeverity(input.severity)) {
      return err(400, "severity must be one of minor|major|critical");
    }
  }

  const origin: Ticket["origin"] =
    input.origin === "autopilot"
      ? "autopilot"
      : input.origin === "manual"
        ? "manual"
        : actor === "service"
          ? "autopilot"
          : "manual";

  const reporter = str(input.reporter) ?? (origin === "autopilot" ? "autopilot" : "human");

  const nextCounter = counter + 1;
  const ticket: Ticket = {
    id,
    ref: formatRef(nextCounter),
    kind,
    title,
    body: typeof input.body === "string" ? input.body : "",
    status: "open", // ALWAYS — input.status is ignored by design
    priority,
    labels: strList(input.labels) ?? [],
    reporter,
    origin,
    activity: [],
    createdAt: now,
    updatedAt: now,
  };

  if (isTicketSeverity(input.severity)) ticket.severity = input.severity;
  const area = str(input.area);
  if (area) ticket.area = area;
  const assignee = str(input.assignee);
  if (assignee) ticket.assignee = assignee;
  const sourceRun = str(input.sourceRun);
  if (sourceRun) ticket.sourceRun = sourceRun;

  pushActivity(ticket, activityActor(actor), "created", `Ticket angelegt von ${reporter}`, now);

  return { ok: true, value: { ticket, counter: nextCounter } };
}

// ---------------------------------------------------------------------------
// Patch — PATCH /api/tickets/[id]
// ---------------------------------------------------------------------------

/**
 * Apply an edit to CONTENT/TRIAGE fields only: { title, body, kind, priority,
 * severity, area, labels, assignee }. status is NEVER writable here — it has
 * its own endpoint (which records the transition). severity/area/assignee are
 * cleared by an explicit ""/null. A changed assignee is recorded as an
 * "assign" activity so hand-overs stay visible in the thread.
 * Open to BOTH actors — triage is part of the AI's job. Mutates and returns
 * the given ticket.
 */
export function applyPatch(
  ticket: Ticket,
  patch: Record<string, unknown>,
  actor: Actor,
  now: string = new Date().toISOString(),
): Result<Ticket> {
  if (patch.kind !== undefined && !isTicketKind(patch.kind)) {
    return err(400, "kind must be one of bug|feature|task|question");
  }
  if (patch.title !== undefined && !str(patch.title)) {
    return err(400, "title must be a non-empty string");
  }
  if (patch.priority !== undefined && !isTicketPriority(patch.priority)) {
    return err(400, "priority must be one of low|medium|high|urgent");
  }
  if (
    patch.severity !== undefined &&
    patch.severity !== null &&
    patch.severity !== "" &&
    !isTicketSeverity(patch.severity)
  ) {
    return err(400, "severity must be one of minor|major|critical");
  }

  if (patch.kind !== undefined) ticket.kind = patch.kind as TicketKind;
  if (patch.title !== undefined) ticket.title = str(patch.title)!;
  if (patch.body !== undefined && typeof patch.body === "string") ticket.body = patch.body;
  if (patch.priority !== undefined) ticket.priority = patch.priority as TicketPriority;
  if (patch.severity !== undefined) {
    if (isTicketSeverity(patch.severity)) ticket.severity = patch.severity as TicketSeverity;
    else delete ticket.severity; // explicit "" / null clears the field
  }
  if (patch.area !== undefined) {
    const area = str(patch.area);
    if (area) ticket.area = area;
    else delete ticket.area;
  }
  if (patch.labels !== undefined) ticket.labels = strList(patch.labels) ?? [];
  if (patch.assignee !== undefined) {
    const assignee = str(patch.assignee);
    if (assignee !== ticket.assignee) {
      if (assignee) ticket.assignee = assignee;
      else delete ticket.assignee;
      pushActivity(
        ticket,
        activityActor(actor),
        "assign",
        assignee ? `Zugewiesen an ${assignee}` : "Zuweisung entfernt",
        now,
      );
    }
  }

  ticket.updatedAt = now;
  return { ok: true, value: ticket };
}

// ---------------------------------------------------------------------------
// Status — POST /api/tickets/[id]/status
// ---------------------------------------------------------------------------

/** Statuses that count as done — they stamp resolvedAt. */
const isTerminal = (s: TicketStatus): boolean => s === "resolved" || s === "closed";

/**
 * Transition a ticket's status. Deliberately open to BOTH actors — the
 * Autopilot works tickets, so it may move them through the whole lifecycle
 * (open → in_progress → blocked/resolved → closed). Every applied transition
 * appends a "status" activity (with the optional note as its text).
 * resolvedAt is stamped when the ticket first enters resolved/closed and
 * cleared again when it is reopened. Mutates the given ticket.
 */
export function applyStatusChange(
  ticket: Ticket,
  status: unknown,
  actor: Actor,
  note?: string,
  now: string = new Date().toISOString(),
): Result<Ticket> {
  if (!isTicketStatus(status)) {
    return err(400, "status must be one of open|in_progress|blocked|resolved|closed");
  }

  const from = ticket.status;
  ticket.status = status;
  if (isTerminal(status)) {
    ticket.resolvedAt = ticket.resolvedAt ?? now;
  } else {
    delete ticket.resolvedAt; // reopening clears the resolution stamp
  }
  pushActivity(
    ticket,
    activityActor(actor),
    "status",
    str(note) ?? `Status ${from} → ${status}`,
    now,
  );
  ticket.updatedAt = now;
  return { ok: true, value: ticket };
}

// ---------------------------------------------------------------------------
// Comment — POST /api/tickets/[id]/comment
// ---------------------------------------------------------------------------

/**
 * Append a comment to the activity thread. The actor label is decided by the
 * route (service tokens ALWAYS write as "autopilot" — no impersonation);
 * humans may post as "human" (default) or "system". Mutates the given ticket.
 */
export function addComment(
  ticket: Ticket,
  text: unknown,
  actor: ActivityActor,
  now: string = new Date().toISOString(),
): Result<Ticket> {
  const t = str(text);
  if (!t) return err(400, "text is required (non-empty string)");
  pushActivity(ticket, actor, "comment", t, now);
  ticket.updatedAt = now;
  return { ok: true, value: ticket };
}

// ---------------------------------------------------------------------------
// Delete — DELETE /api/tickets/[id]  (THE DELETE BOUNDARY)
// ---------------------------------------------------------------------------

/**
 * Remove a ticket — HUMAN-ONLY. A service actor (Autopilot / gateway token)
 * gets a 403 with DELETE_BOUNDARY_ERROR: the AI may file, comment, triage and
 * resolve, but it may never erase the record. Returns the remaining tickets.
 */
export function applyDelete(
  tickets: Ticket[],
  id: string,
  actor: Actor,
): Result<Ticket[]> {
  if (actor === "service") return err(403, DELETE_BOUNDARY_ERROR);
  const next = tickets.filter((t) => t.id !== id);
  if (next.length === tickets.length) return err(404, `no ticket with id ${id}`);
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// List — GET /api/tickets?status=&kind=&priority=&label=&assignee=&q=
// ---------------------------------------------------------------------------

export interface TicketFilter {
  status?: string;
  kind?: string;
  priority?: string;
  label?: string;
  assignee?: string;
  /** Case-insensitive substring over title, body and ref. */
  q?: string;
}

/** Filter + sort newest-first by createdAt. */
export function filterTickets(tickets: Ticket[], filter: TicketFilter): Ticket[] {
  let out = tickets;
  if (filter.status) out = out.filter((t) => t.status === filter.status);
  if (filter.kind) out = out.filter((t) => t.kind === filter.kind);
  if (filter.priority) out = out.filter((t) => t.priority === filter.priority);
  if (filter.label) out = out.filter((t) => t.labels.includes(filter.label!));
  if (filter.assignee) out = out.filter((t) => t.assignee === filter.assignee);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.ref.toLowerCase().includes(q),
    );
  }
  return out.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Board — GET /api/board
// ---------------------------------------------------------------------------

export interface BoardView {
  counts: {
    total: number;
    status: Record<TicketStatus, number>;
    priority: Record<TicketPriority, number>;
    kind: Record<TicketKind, number>;
    /** Everything not yet done: open + in_progress + blocked. */
    open: number;
  };
  /** The 20 newest tickets. */
  recent: Ticket[];
  /** Not-yet-done tickets with priority "urgent", newest first. */
  urgent: Ticket[];
}

export function compileBoard(state: TicketsState): BoardView {
  const counts: BoardView["counts"] = {
    total: state.tickets.length,
    status: { open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 },
    priority: { low: 0, medium: 0, high: 0, urgent: 0 },
    kind: { bug: 0, feature: 0, task: 0, question: 0 },
    open: 0,
  };
  for (const t of state.tickets) {
    counts.status[t.status]++;
    counts.priority[t.priority]++;
    counts.kind[t.kind]++;
    if (!isTerminal(t.status)) counts.open++;
  }

  const newestFirst = state.tickets
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    counts,
    recent: newestFirst.slice(0, 20),
    urgent: newestFirst.filter((t) => t.priority === "urgent" && !isTerminal(t.status)),
  };
}
