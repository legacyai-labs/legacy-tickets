import { TicketsBoard } from "@/components/TicketsBoard";
import { ensureAuthed } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page() {
  await ensureAuthed();
  return <TicketsBoard />;
}
