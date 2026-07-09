import { NextRequest, NextResponse } from "next/server";
import { allowed } from "@/lib/guard";
import { getStore } from "@/lib/tickets/store";
import { compileBoard } from "@/lib/tickets/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/board — compiled overview: counts per status/priority/kind, the
// not-yet-done total, the 20 newest tickets, and the urgent open tickets.
export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(compileBoard(getStore().load()));
}
