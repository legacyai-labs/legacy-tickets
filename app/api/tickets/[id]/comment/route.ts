import { NextRequest, NextResponse } from "next/server";
import { authKind } from "@/lib/guard";
import { getStore } from "@/lib/tickets/store";
import { addComment } from "@/lib/tickets/logic";
import type { ActivityActor } from "@/lib/tickets/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/tickets/[id]/comment — { text, actor? }. A service caller ALWAYS
// writes as "autopilot" (no impersonation); a human writes as "human" by
// default and may label a comment "system" (e.g. pasted tool output).
export async function POST(req: NextRequest, { params }: Params) {
  const caller = await authKind(req);
  if (caller === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const store = getStore();
  const state = store.load();
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket) return NextResponse.json({ error: `no ticket with id ${id}` }, { status: 404 });

  const actor: ActivityActor =
    caller === "service" ? "autopilot" : body.actor === "system" ? "system" : "human";
  const r = addComment(ticket, body.text, actor);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  store.save(state);
  return NextResponse.json(r.value);
}
