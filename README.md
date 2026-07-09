# legacy-tickets — Ticket Board

The **operative memory** of the Legacy fleet (see [`VISION.md`](./VISION.md)
for the full product intent). Bugs, tasks, feature ideas and questions land
here as tickets — filed by humans in the board AND by the Autopilot via
MCP/gateway. The AI retrieves open tickets, works them, comments its progress
and sets statuses: the self-optimization loop. Deleting a ticket stays a human
act.

A Next.js 15 / React 19 studio app in the shared Legacy design language
(same tokens/components as `legacy-vision` and `legacy-blog`): the tickets
domain lives in `lib/tickets/`, thin `app/api/**` routes wrap it, and `/board`
is the surface where the fleet's state becomes visible.

## The flow

```text
1. A human (board) or the Autopilot (gateway) files a ticket — bug, task,
   feature or question. It gets a human-friendly ref (TCK-001, TCK-002, …).
2. The Autopilot lists open tickets / the board view and picks up work.
3. Progress lands on the ticket: comments and status changes, each one an
   actor-labeled activity (human / autopilot / system).
4. resolved/closed stamp resolvedAt; reopening clears it.
5. A human reviews in /board — and is the ONLY one who can delete.
```

Status flow: `open → in_progress → resolved → closed`, with `blocked` as a
side state and reopening allowed from anywhere.

## The delete boundary (the one rule that matters)

**Everything but deletion is open to the AI.** Filing, editing, triaging
(priority/labels/area/assignee), commenting and EVERY status transition —
including `resolved` and `closed` — are deliberately allowed for service
tokens: they are internal ops without Aussenwirkung, fully auditable in the
activity thread, and exactly what the self-optimization loop needs.

- **Service auth** (gateway bearer `TICKETS_API_TOKEN` or header
  `x-tickets-token: TICKETS_TOKEN`) may create, read, patch, comment and set
  any status. Service writes are actor-labeled `autopilot` in the activity
  thread (no impersonation).
- **Only human auth** (the `/login` cookie) may DELETE — a service token
  attempting it gets
  `403 { "error": "Loeschen nur durch Menschen im Ticket-Board" }`.
  Removal erases memory (including the AI's own protocol), so it is a human
  act in the board UI. The gateway deliberately exposes **no** delete tool.

The rule is enforced in the domain layer (`applyDelete(tickets, id, actor)` in
`lib/tickets/logic.ts`), not just in the route — and covered by tests.

## Data model

`lib/tickets/model.ts`:

```
Ticket {
  id, ref ("TCK-001" — monotonic counter in the store),
  kind: bug|feature|task|question,
  title, body (markdown),
  status: open|in_progress|blocked|resolved|closed,
  priority: low|medium|high|urgent,
  severity?: minor|major|critical (bugs),
  area?, labels[], reporter, assignee?,
  origin: autopilot|manual, sourceRun?,
  activity[] { id, ts, actor: human|autopilot|system,
               kind: comment|status|assign|created, text },
  createdAt, updatedAt, resolvedAt?
}
```

Persisted as JSON at `(TICKETS_DATA_DIR ?? DATA_DIR ?? /data)/legacy-tickets.json`
with shape `{ tickets, counter }`. The store (`lib/tickets/store.ts`) never
throws: missing volume → in-memory state; corrupt file → empty state.

**Migration-safe loader:** a file without a `counter` derives it from the
highest `TCK-xxx` ref (refs stay monotonic), missing `labels`/`activity`
arrays are backfilled, junk is dropped. Reading alone never rewrites the file;
the normalised shape lands on the next save.

## Routes

All `/api/*` routes require auth and **fail closed** (unconfigured deploy ⇒
401 for everyone). `H` = human-only.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Readiness probe, unauthenticated. |
| POST | `/api/login` | Password → httpOnly auth cookie (30 days). |
| GET | `/api/tickets?status=&kind=&priority=&label=&assignee=&q=` | List tickets (newest-first) → `{ tickets, count }`. `q` = title/body/ref substring. |
| POST | `/api/tickets` | Create `{ kind?, title!, body?, priority?=medium, severity?, area?, labels?, reporter?, assignee?, origin?, sourceRun? }`. Status is **always `open`**; the ref comes from the monotonic counter. A service caller files as `origin:"autopilot"` by default. |
| GET | `/api/tickets/:id` | One ticket, 404 when unknown. |
| PATCH | `/api/tickets/:id` | Edit content/triage fields (`title,body,kind,priority,severity,area,labels,assignee`). Never status. A changed assignee is recorded as an `assign` activity. |
| POST | `/api/tickets/:id/status` | `{ status, note? }` — any status, both actors. Appends a `status` activity; `resolved`/`closed` stamp `resolvedAt`, reopening clears it. |
| POST | `/api/tickets/:id/comment` | `{ text, actor? }` — appends a `comment` activity. Service callers ALWAYS write as `autopilot`; humans as `human` (or `system`). |
| DELETE | `/api/tickets/:id` | `H` Remove a ticket — **the delete boundary**. Service → 403. |
| GET | `/api/board` | Compiled view: `{ counts { total, status, priority, kind, open }, recent (≤20), urgent }`. |

Pages: `/` → redirects to `/board` · `/board` (cookie-gated studio) · `/login`.

## Gateway tools (`tickets.*` via legacy-gateway)

The 7 tools the gateway wraps around these routes:

| Tool | Route | Notes |
|------|-------|-------|
| `tickets.create` | `POST /api/tickets` | Files as `origin:"autopilot"`. |
| `tickets.list` | `GET /api/tickets` | Filter by status/kind/priority/label/assignee/q. |
| `tickets.get` | `GET /api/tickets/:id` | |
| `tickets.update` | `PATCH /api/tickets/:id` | Content/triage fields only. |
| `tickets.set_status` | `POST /api/tickets/:id/status` | Full lifecycle — incl. resolved/closed. |
| `tickets.comment` | `POST /api/tickets/:id/comment` | Actor-labeled `autopilot`. |
| `tickets.board` | `GET /api/board` | Counts + recent + urgent. |

**Deliberately absent:** there is *no* `tickets.delete` tool. Removal is a
human act in the board UI. This is the delete boundary expressed at the tool
surface, not just as a server-side check.

## Env vars

| Var | Required | Purpose |
|-----|----------|---------|
| `STUDIO_PASSWORD` | in any real deploy | Enables the `/login` gate. Without it the API fails **closed** (service tokens only, no human writes — and no deletes at all). |
| `TICKETS_API_TOKEN` | no | Bearer the nexus gateway presents (`Authorization: Bearer …`). Service auth. |
| `TICKETS_TOKEN` | no | Alternative service token (header `x-tickets-token`) for MCP/Autopilot. |
| `TICKETS_DATA_DIR` | no | JSON store directory. Fallback chain: `TICKETS_DATA_DIR` → `DATA_DIR` → `/data`. |

See `.env.example`.

## Run locally

```bash
npm install
npm run typecheck    # strict, must be clean
npm test             # vitest — logic (boundary, lifecycle, refs), store+migration, guard
npm run dev          # http://localhost:3000 (set STUDIO_PASSWORD to test the gate)
npm run build        # next build
```

Quick check against a running instance:

```bash
curl localhost:3000/health
# the Autopilot files a bug (lands as origin autopilot, ref TCK-…):
curl -sX POST localhost:3000/api/tickets -H "x-tickets-token: $TICKETS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"bug","title":"Deck-Export bricht ab","severity":"major","area":"deck","sourceRun":"run-42"}'
# it works the ticket:
curl -sX POST localhost:3000/api/tickets/<id>/status -H "x-tickets-token: $TICKETS_TOKEN" \
  -H 'content-type: application/json' -d '{"status":"in_progress"}'
curl -sX POST localhost:3000/api/tickets/<id>/comment -H "x-tickets-token: $TICKETS_TOKEN" \
  -H 'content-type: application/json' -d '{"text":"Ursache gefunden: Timeout im Renderer"}'
# it may NOT delete — 403 Loeschen nur durch Menschen im Ticket-Board:
curl -sX DELETE localhost:3000/api/tickets/<id> -H "x-tickets-token: $TICKETS_TOKEN"
```

## Deploy

Docker: `Dockerfile` (node:22-slim, `TICKETS_DATA_DIR=/data`, non-root,
`/data` volume). Nexus app + volume + injected `TICKETS_API_TOKEN`, like the
sibling satellites.
