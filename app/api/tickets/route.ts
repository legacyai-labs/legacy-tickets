import { NextRequest, NextResponse } from "next/server";
import { allowed, authKind } from "@/lib/guard";
import { getStore } from "@/lib/tickets/store";
import { createTicket, filterTickets } from "@/lib/tickets/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tickets?status=&kind=&priority=&label=&assignee=&q= — newest-first
// by createdAt; q is a case-insensitive substring over title/body/ref.
export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const tickets = filterTickets(getStore().load().tickets, {
    status: q.get("status") ?? undefined,
    kind: q.get("kind") ?? undefined,
    priority: q.get("priority") ?? undefined,
    label: q.get("label") ?? undefined,
    assignee: q.get("assignee") ?? undefined,
    q: q.get("q") ?? undefined,
  });
  return NextResponse.json({ tickets, count: tickets.length });
}

// POST /api/tickets — create; status is ALWAYS "open" (any status in the body
// is ignored) and the ref is assigned from the store's monotonic counter.
// A service caller (Autopilot / gateway) files as origin "autopilot" by
// default; a human in the board as "manual".
export async function POST(req: NextRequest) {
  const actor = await authKind(req);
  if (actor === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const store = getStore();
  const state = store.load();
  const r = createTicket(body, actor, state.counter);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  state.tickets.push(r.value.ticket);
  state.counter = r.value.counter;
  store.save(state);
  return NextResponse.json(r.value.ticket);
}
