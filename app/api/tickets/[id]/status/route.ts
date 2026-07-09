import { NextRequest, NextResponse } from "next/server";
import { authKind } from "@/lib/guard";
import { getStore } from "@/lib/tickets/store";
import { applyStatusChange } from "@/lib/tickets/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/tickets/[id]/status — { status, note? }. Deliberately open to
// BOTH actors: the Autopilot works tickets, so it may move them through the
// whole lifecycle (open|in_progress|blocked|resolved|closed). Every applied
// transition appends a "status" activity; resolved/closed stamp resolvedAt,
// reopening clears it. Only DELETE is human-only.
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authKind(req);
  if (actor === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const store = getStore();
  const state = store.load();
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket) return NextResponse.json({ error: `no ticket with id ${id}` }, { status: 404 });

  const note = typeof body.note === "string" ? body.note : undefined;
  const r = applyStatusChange(ticket, body.status, actor, note);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  store.save(state);
  return NextResponse.json(r.value);
}
