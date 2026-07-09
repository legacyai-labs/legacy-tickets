import { NextRequest, NextResponse } from "next/server";
import { allowed, authKind } from "@/lib/guard";
import { getStore } from "@/lib/tickets/store";
import { applyDelete, applyPatch } from "@/lib/tickets/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await allowed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = getStore().load().tickets.find((t) => t.id === id);
  if (!ticket) return NextResponse.json({ error: `no ticket with id ${id}` }, { status: 404 });
  return NextResponse.json(ticket);
}

// PATCH — content/triage fields only ({title,body,kind,priority,severity,area,
// labels,assignee}). status is NEVER writable here; it has its own endpoint
// that records the transition. Open to both actors — triage is part of the
// AI's job; only DELETE below is human-only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = await authKind(req);
  if (actor === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const store = getStore();
  const state = store.load();
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket) return NextResponse.json({ error: `no ticket with id ${id}` }, { status: 404 });

  const r = applyPatch(ticket, body, actor);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  store.save(state);
  return NextResponse.json(r.value);
}

// DELETE — human-only (login cookie): THE DELETE BOUNDARY. Service tokens may
// file, comment, triage and resolve, but never erase the record — the AI must
// not be able to delete its own protocol.
export async function DELETE(req: NextRequest, { params }: Params) {
  const actor = await authKind(req);
  if (actor === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const store = getStore();
  const state = store.load();
  const r = applyDelete(state.tickets, id, actor);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  state.tickets = r.value;
  store.save(state);
  return NextResponse.json({ ok: true });
}
