// Domain model for legacy-tickets — the operative memory of the fleet.
//
// A ticket board holds TICKETS (bugs, features, tasks, questions). Humans AND
// the Autopilot (via MCP/gateway) file them, retrieve them and work them — the
// AI self-optimization loop. Every ticket carries a human-friendly ref
// ("TCK-001", a monotonic counter in the store) and an ACTIVITY thread
// (comments, status changes, assignments — actor-labeled human/autopilot/
// system) so the collaboration between operator and AI stays auditable.
// There is deliberately NO LLM inside this service; the intelligence (triage,
// working the tickets) comes from the Autopilot via MCP.
//
// THE one boundary: deleting a ticket is HUMAN-ONLY (see logic.applyDelete) —
// the AI must never be able to erase its own protocol.

export type TicketKind = "bug" | "feature" | "task" | "question";

export type TicketStatus = "open" | "in_progress" | "blocked" | "resolved" | "closed";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

/** Bug weight — only meaningful for kind "bug", optional everywhere. */
export type TicketSeverity = "minor" | "major" | "critical";

export const TICKET_KINDS: TicketKind[] = ["bug", "feature", "task", "question"];

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "resolved",
  "closed",
];

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

export const TICKET_SEVERITIES: TicketSeverity[] = ["minor", "major", "critical"];

/** Who did something on a ticket — the label shown in the activity thread. */
export type ActivityActor = "human" | "autopilot" | "system";

export type ActivityKind = "comment" | "status" | "assign" | "created";

/** One row of the activity thread — the audit trail of the collaboration. */
export interface Activity {
  id: string;
  ts: string;
  actor: ActivityActor;
  kind: ActivityKind;
  text: string;
}

export interface Ticket {
  id: string;
  /** Human-friendly reference like "TCK-001" — monotonic counter in the store. */
  ref: string;
  kind: TicketKind;
  title: string;
  /** Markdown body. */
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  severity?: TicketSeverity;
  /** Freeform component/satellite tag, e.g. "blog" or "gateway". */
  area?: string;
  labels: string[];
  /** Who filed it — "autopilot" or a name. */
  reporter: string;
  assignee?: string;
  origin: "autopilot" | "manual";
  /** Id of the autopilot run that produced this ticket, when it did. */
  sourceRun?: string;
  activity: Activity[];
  createdAt: string;
  updatedAt: string;
  /** Set when the ticket enters resolved/closed; cleared on reopen. */
  resolvedAt?: string;
}

/** The whole persisted board: tickets + the monotonic ref counter. */
export interface TicketsState {
  tickets: Ticket[];
  counter: number;
}

/** Fresh empty state — the in-memory seed when no volume is mounted. */
export function emptyState(): TicketsState {
  return { tickets: [], counter: 0 };
}

/** "TCK-001", "TCK-042", "TCK-1000" — zero-padded to 3, grows naturally. */
export function formatRef(n: number): string {
  return `TCK-${String(n).padStart(3, "0")}`;
}

export function isTicketKind(v: unknown): v is TicketKind {
  return typeof v === "string" && (TICKET_KINDS as string[]).includes(v);
}

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as string[]).includes(v);
}

export function isTicketPriority(v: unknown): v is TicketPriority {
  return typeof v === "string" && (TICKET_PRIORITIES as string[]).includes(v);
}

export function isTicketSeverity(v: unknown): v is TicketSeverity {
  return typeof v === "string" && (TICKET_SEVERITIES as string[]).includes(v);
}
