import { describe, it, expect } from "vitest";
import {
  DELETE_BOUNDARY_ERROR,
  activityActor,
  addComment,
  applyDelete,
  applyPatch,
  applyStatusChange,
  compileBoard,
  createTicket,
  filterTickets,
} from "../lib/tickets/logic";
import { formatRef, type Ticket } from "../lib/tickets/model";

const NOW = "2026-07-09T12:00:00.000Z";
const EARLIER = "2026-07-01T00:00:00.000Z";

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    ref: "TCK-001",
    kind: "bug",
    title: "Ein Bug",
    body: "",
    status: "open",
    priority: "medium",
    labels: [],
    reporter: "human",
    origin: "manual",
    activity: [],
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// createTicket — POST /api/tickets
// ---------------------------------------------------------------------------

describe("createTicket", () => {
  it("applies the defaults: kind task, priority medium, status open, empty labels/body", () => {
    const r = createTicket({ title: "Nur ein Titel" }, "human", 0, NOW, "id-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ticket).toMatchObject({
      id: "id-1",
      ref: "TCK-001",
      kind: "task",
      title: "Nur ein Titel",
      body: "",
      status: "open",
      priority: "medium",
      labels: [],
      reporter: "human",
      origin: "manual",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(r.value.counter).toBe(1);
  });

  it("requires a non-empty title", () => {
    for (const title of [undefined, "", "   ", 42]) {
      const r = createTicket({ title }, "human", 0, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it("ALWAYS creates as open — a status in the body is ignored", () => {
    const r = createTicket({ title: "Schlau", status: "resolved" }, "human", 0, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ticket.status).toBe("open");
  });

  it("assigns monotonic refs from the counter (TCK-001, TCK-002, …)", () => {
    const a = createTicket({ title: "eins" }, "human", 0, NOW);
    expect(a.ok && a.value.ticket.ref).toBe("TCK-001");
    const b = createTicket({ title: "zwei" }, "human", a.ok ? a.value.counter : 0, NOW);
    expect(b.ok && b.value.ticket.ref).toBe("TCK-002");
    const c = createTicket({ title: "hundert" }, "human", 99, NOW);
    expect(c.ok && c.value.ticket.ref).toBe("TCK-100");
    expect(formatRef(1000)).toBe("TCK-1000"); // grows beyond the padding
  });

  it("rejects an unknown kind, priority and severity", () => {
    expect(createTicket({ title: "x", kind: "epic" }, "human", 0, NOW).ok).toBe(false);
    expect(createTicket({ title: "x", priority: "asap" }, "human", 0, NOW).ok).toBe(false);
    expect(createTicket({ title: "x", severity: "huge" }, "human", 0, NOW).ok).toBe(false);
  });

  it("a SERVICE caller files as origin autopilot / reporter autopilot by default", () => {
    const r = createTicket({ title: "Run kaputt" }, "service", 0, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ticket.origin).toBe("autopilot");
    expect(r.value.ticket.reporter).toBe("autopilot");
  });

  it("a HUMAN caller files as origin manual by default; explicit origin wins", () => {
    const manual = createTicket({ title: "x" }, "human", 0, NOW);
    expect(manual.ok && manual.value.ticket.origin).toBe("manual");
    const stamped = createTicket({ title: "x", origin: "autopilot" }, "human", 0, NOW);
    expect(stamped.ok && stamped.value.ticket.origin).toBe("autopilot");
    const forcedManual = createTicket({ title: "x", origin: "manual" }, "service", 0, NOW);
    expect(forcedManual.ok && forcedManual.value.ticket.origin).toBe("manual");
  });

  it("keeps the optional fields (severity, area, labels, assignee, reporter, sourceRun)", () => {
    const r = createTicket(
      {
        title: "Deck-Export bricht",
        kind: "bug",
        priority: "urgent",
        severity: "critical",
        area: "deck",
        labels: ["regression", " export ", 7, ""],
        reporter: "luis",
        assignee: "autopilot",
        origin: "autopilot",
        sourceRun: "run-42",
      },
      "service",
      41,
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.ticket;
    expect(t.ref).toBe("TCK-042");
    expect(t.kind).toBe("bug");
    expect(t.priority).toBe("urgent");
    expect(t.severity).toBe("critical");
    expect(t.area).toBe("deck");
    expect(t.labels).toEqual(["regression", "export"]); // trimmed, non-strings dropped
    expect(t.reporter).toBe("luis");
    expect(t.assignee).toBe("autopilot");
    expect(t.sourceRun).toBe("run-42");
  });

  it("records the birth as a 'created' activity with the caller's actor label", () => {
    const r = createTicket({ title: "x" }, "service", 0, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ticket.activity).toHaveLength(1);
    expect(r.value.ticket.activity[0]).toMatchObject({
      ts: NOW,
      actor: "autopilot",
      kind: "created",
    });
    const h = createTicket({ title: "y" }, "human", 0, NOW);
    expect(h.ok && h.value.ticket.activity[0]!.actor).toBe("human");
  });
});

describe("activityActor", () => {
  it("maps service → autopilot and human → human", () => {
    expect(activityActor("service")).toBe("autopilot");
    expect(activityActor("human")).toBe("human");
  });
});

// ---------------------------------------------------------------------------
// applyPatch — PATCH /api/tickets/[id]
// ---------------------------------------------------------------------------

describe("applyPatch", () => {
  it("updates a subset of content/triage fields and bumps updatedAt", () => {
    const t = makeTicket();
    const r = applyPatch(t, { title: "Neu", body: "Mehr Text", kind: "feature", priority: "high" }, "human", NOW);
    expect(r.ok).toBe(true);
    expect(t.title).toBe("Neu");
    expect(t.body).toBe("Mehr Text");
    expect(t.kind).toBe("feature");
    expect(t.priority).toBe("high");
    expect(t.updatedAt).toBe(NOW);
    expect(t.createdAt).toBe(EARLIER); // untouched
  });

  it("NEVER writes status — the field is simply not applied", () => {
    const t = makeTicket({ status: "open" });
    const r = applyPatch(t, { status: "closed" }, "human", NOW);
    expect(r.ok).toBe(true);
    expect(t.status).toBe("open");
  });

  it("rejects an empty title, unknown kind, priority and severity", () => {
    expect(applyPatch(makeTicket(), { title: "  " }, "human", NOW).ok).toBe(false);
    expect(applyPatch(makeTicket(), { kind: "epic" }, "human", NOW).ok).toBe(false);
    expect(applyPatch(makeTicket(), { priority: "asap" }, "human", NOW).ok).toBe(false);
    expect(applyPatch(makeTicket(), { severity: "huge" }, "human", NOW).ok).toBe(false);
  });

  it("clears severity/area/assignee when patched to empty", () => {
    const t = makeTicket({ severity: "major", area: "blog", assignee: "luis" });
    applyPatch(t, { severity: "", area: "", assignee: "" }, "human", NOW);
    expect(t.severity).toBeUndefined();
    expect(t.area).toBeUndefined();
    expect(t.assignee).toBeUndefined();
  });

  it("replaces labels (trimmed, non-strings dropped)", () => {
    const t = makeTicket({ labels: ["alt"] });
    applyPatch(t, { labels: [" neu ", "", 3, "zwei"] }, "human", NOW);
    expect(t.labels).toEqual(["neu", "zwei"]);
  });

  it("a SERVICE actor may patch too — triage is part of the AI's job", () => {
    const t = makeTicket();
    const r = applyPatch(t, { priority: "urgent", area: "gateway" }, "service", NOW);
    expect(r.ok).toBe(true);
    expect(t.priority).toBe("urgent");
    expect(t.area).toBe("gateway");
  });

  it("records an 'assign' activity when the assignee changes (actor-labeled)", () => {
    const t = makeTicket();
    applyPatch(t, { assignee: "autopilot" }, "service", NOW);
    expect(t.activity).toHaveLength(1);
    expect(t.activity[0]).toMatchObject({ actor: "autopilot", kind: "assign", text: "Zugewiesen an autopilot" });
    applyPatch(t, { assignee: "" }, "human", NOW);
    expect(t.activity).toHaveLength(2);
    expect(t.activity[1]).toMatchObject({ actor: "human", kind: "assign", text: "Zuweisung entfernt" });
  });

  it("does NOT record an 'assign' activity when the assignee is unchanged", () => {
    const t = makeTicket({ assignee: "luis" });
    applyPatch(t, { assignee: "luis", title: "Neu" }, "human", NOW);
    expect(t.activity).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyStatusChange — POST /api/tickets/[id]/status
// ---------------------------------------------------------------------------

describe("applyStatusChange", () => {
  it("moves through the lifecycle and appends a 'status' activity each time", () => {
    const t = makeTicket({ status: "open" });
    expect(applyStatusChange(t, "in_progress", "human", undefined, NOW).ok).toBe(true);
    expect(t.status).toBe("in_progress");
    expect(applyStatusChange(t, "blocked", "human", undefined, NOW).ok).toBe(true);
    expect(t.status).toBe("blocked");
    expect(t.activity).toHaveLength(2); // every transition appends
    expect(t.activity[0]!.kind).toBe("status");
    expect(t.activity[0]!.text).toBe("Status open → in_progress");
  });

  it("a SERVICE actor may set ANY status — incl. resolved and closed", () => {
    for (const status of ["in_progress", "blocked", "resolved", "closed", "open"] as const) {
      const t = makeTicket({ status: "open" });
      const r = applyStatusChange(t, status, "service", undefined, NOW);
      expect(r.ok).toBe(true);
      expect(t.status).toBe(status);
      expect(t.activity[0]!.actor).toBe("autopilot"); // actor-labeled
    }
  });

  it("stamps resolvedAt on resolved and closed", () => {
    const a = makeTicket({ status: "in_progress" });
    applyStatusChange(a, "resolved", "service", undefined, NOW);
    expect(a.resolvedAt).toBe(NOW);
    const b = makeTicket({ status: "open" });
    applyStatusChange(b, "closed", "human", undefined, NOW);
    expect(b.resolvedAt).toBe(NOW);
  });

  it("keeps the FIRST resolution stamp when moving resolved → closed", () => {
    const t = makeTicket({ status: "resolved", resolvedAt: EARLIER });
    applyStatusChange(t, "closed", "human", undefined, NOW);
    expect(t.resolvedAt).toBe(EARLIER);
  });

  it("reopening clears resolvedAt", () => {
    const t = makeTicket({ status: "resolved", resolvedAt: EARLIER });
    applyStatusChange(t, "open", "human", undefined, NOW);
    expect(t.status).toBe("open");
    expect(t.resolvedAt).toBeUndefined();
  });

  it("rejects an unknown status with 400 — nothing recorded", () => {
    const t = makeTicket();
    const r = applyStatusChange(t, "done", "human", undefined, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(t.status).toBe("open");
    expect(t.activity).toHaveLength(0);
  });

  it("a custom note becomes the activity text", () => {
    const t = makeTicket({ status: "in_progress" });
    applyStatusChange(t, "resolved", "service", "Fix deployed, bitte pruefen", NOW);
    expect(t.activity[0]).toMatchObject({
      actor: "autopilot",
      kind: "status",
      text: "Fix deployed, bitte pruefen",
      ts: NOW,
    });
    expect(t.updatedAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// addComment — POST /api/tickets/[id]/comment
// ---------------------------------------------------------------------------

describe("addComment", () => {
  it("appends a comment activity with the given actor label", () => {
    const t = makeTicket();
    const r = addComment(t, "Analyse: Ursache im Guard", "autopilot", NOW);
    expect(r.ok).toBe(true);
    expect(t.activity).toHaveLength(1);
    expect(t.activity[0]).toMatchObject({
      actor: "autopilot",
      kind: "comment",
      text: "Analyse: Ursache im Guard",
      ts: NOW,
    });
    expect(t.updatedAt).toBe(NOW);
  });

  it("supports human and system actors too", () => {
    const t = makeTicket();
    addComment(t, "gesehen", "human", NOW);
    addComment(t, "log angehaengt", "system", NOW);
    expect(t.activity.map((a) => a.actor)).toEqual(["human", "system"]);
  });

  it("rejects an empty text with 400", () => {
    for (const text of [undefined, "", "   ", 42]) {
      const t = makeTicket();
      const r = addComment(t, text, "human", NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
      expect(t.activity).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// applyDelete — THE DELETE BOUNDARY (human-only)
// ---------------------------------------------------------------------------

describe("applyDelete (delete boundary)", () => {
  it("a HUMAN may delete — the ticket is removed", () => {
    const tickets = [makeTicket({ id: "a" }), makeTicket({ id: "b" })];
    const r = applyDelete(tickets, "a", "human");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((t) => t.id)).toEqual(["b"]);
  });

  it("a SERVICE actor may NOT delete — 403 with the exact boundary error", () => {
    const tickets = [makeTicket({ id: "a" })];
    const r = applyDelete(tickets, "a", "service");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toBe(DELETE_BOUNDARY_ERROR);
      expect(r.error).toBe("Loeschen nur durch Menschen im Ticket-Board");
    }
    expect(tickets).toHaveLength(1); // untouched
  });

  it("the boundary holds even for unknown ids (403 before 404 — no probing)", () => {
    const r = applyDelete([makeTicket({ id: "a" })], "ghost", "service");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("404 for a human deleting an unknown id", () => {
    const r = applyDelete([makeTicket({ id: "a" })], "ghost", "human");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// filterTickets — GET /api/tickets
// ---------------------------------------------------------------------------

describe("filterTickets", () => {
  const tickets = [
    makeTicket({ id: "a", ref: "TCK-001", status: "open", kind: "bug", priority: "urgent", labels: ["ui"], body: "Der Editor verliert Tags", createdAt: "2026-07-01T00:00:00.000Z" }),
    makeTicket({ id: "b", ref: "TCK-002", status: "in_progress", kind: "task", priority: "medium", labels: ["ui", "daten"], assignee: "autopilot", createdAt: "2026-07-03T00:00:00.000Z" }),
    makeTicket({ id: "c", ref: "TCK-003", status: "resolved", kind: "feature", priority: "low", assignee: "luis", title: "Suchfeld im Board", createdAt: "2026-07-02T00:00:00.000Z" }),
  ];

  it("filters by status, kind, priority, label and assignee", () => {
    expect(filterTickets(tickets, { status: "in_progress" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTickets(tickets, { kind: "feature" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTickets(tickets, { priority: "urgent" }).map((t) => t.id)).toEqual(["a"]);
    expect(filterTickets(tickets, { label: "ui" }).map((t) => t.id)).toEqual(["b", "a"]);
    expect(filterTickets(tickets, { assignee: "luis" }).map((t) => t.id)).toEqual(["c"]);
  });

  it("q searches title, body and ref (case-insensitive substring)", () => {
    expect(filterTickets(tickets, { q: "suchfeld" }).map((t) => t.id)).toEqual(["c"]); // title
    expect(filterTickets(tickets, { q: "verliert tags" }).map((t) => t.id)).toEqual(["a"]); // body
    expect(filterTickets(tickets, { q: "tck-002" }).map((t) => t.id)).toEqual(["b"]); // ref
    expect(filterTickets(tickets, { q: "nirgends" })).toEqual([]);
  });

  it("combines filters and sorts newest-first by createdAt", () => {
    expect(filterTickets(tickets, {}).map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(filterTickets(tickets, { label: "ui", status: "open" }).map((t) => t.id)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// compileBoard — GET /api/board
// ---------------------------------------------------------------------------

describe("compileBoard", () => {
  const tickets = [
    makeTicket({ id: "a", status: "open", priority: "urgent", kind: "bug", createdAt: "2026-07-01T00:00:00.000Z" }),
    makeTicket({ id: "b", status: "in_progress", priority: "urgent", kind: "task", createdAt: "2026-07-04T00:00:00.000Z" }),
    makeTicket({ id: "c", status: "blocked", priority: "medium", kind: "bug", createdAt: "2026-07-02T00:00:00.000Z" }),
    makeTicket({ id: "d", status: "resolved", priority: "urgent", kind: "feature", createdAt: "2026-07-03T00:00:00.000Z" }),
    makeTicket({ id: "e", status: "closed", priority: "low", kind: "question", createdAt: "2026-07-05T00:00:00.000Z" }),
  ];
  const board = compileBoard({ tickets, counter: 5 });

  it("counts by status, priority and kind", () => {
    expect(board.counts.total).toBe(5);
    expect(board.counts.status).toEqual({ open: 1, in_progress: 1, blocked: 1, resolved: 1, closed: 1 });
    expect(board.counts.priority).toEqual({ low: 1, medium: 1, high: 0, urgent: 3 });
    expect(board.counts.kind).toEqual({ bug: 2, feature: 1, task: 1, question: 1 });
  });

  it("counts the not-yet-done tickets as open (open + in_progress + blocked)", () => {
    expect(board.counts.open).toBe(3);
  });

  it("urgent highlights = urgent priority AND not resolved/closed, newest first", () => {
    expect(board.urgent.map((t) => t.id)).toEqual(["b", "a"]); // d is resolved → out
  });

  it("recent lists the newest tickets first, capped at 20", () => {
    expect(board.recent.map((t) => t.id)).toEqual(["e", "b", "d", "c", "a"]);
    const many = Array.from({ length: 30 }, (_, i) =>
      makeTicket({ id: `m${i}`, createdAt: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    expect(compileBoard({ tickets: many, counter: 30 }).recent).toHaveLength(20);
  });

  it("handles the empty board", () => {
    const empty = compileBoard({ tickets: [], counter: 0 });
    expect(empty.counts.total).toBe(0);
    expect(empty.counts.open).toBe(0);
    expect(empty.recent).toEqual([]);
    expect(empty.urgent).toEqual([]);
  });
});
