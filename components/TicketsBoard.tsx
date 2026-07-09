"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Plus,
  Pencil,
  Check,
  X,
  Archive,
  Loader2,
  Bug,
  Sparkles,
  CheckSquare,
  HelpCircle,
  Bot,
  Trash2,
  Play,
  Ban,
  RotateCcw,
  MessageSquare,
  Send,
  UserRound,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";

import { KeystoneGlyph } from "@/components/Keystone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { renderMarkdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type TicketKind = "bug" | "feature" | "task" | "question";
type TicketStatus = "open" | "in_progress" | "blocked" | "resolved" | "closed";
type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketSeverity = "minor" | "major" | "critical";
type ActivityActor = "human" | "autopilot" | "system";
interface Activity {
  id: string;
  ts: string;
  actor: ActivityActor;
  kind: "comment" | "status" | "assign" | "created";
  text: string;
}
interface Ticket {
  id: string; ref: string; kind: TicketKind; title: string; body: string;
  status: TicketStatus; priority: TicketPriority; severity?: TicketSeverity;
  area?: string; labels: string[]; reporter: string; assignee?: string;
  origin: "autopilot" | "manual"; sourceRun?: string;
  activity: Activity[];
  createdAt: string; updatedAt: string; resolvedAt?: string;
}

const KINDS: TicketKind[] = ["bug", "feature", "task", "question"];
const KIND_LABEL: Record<TicketKind, string> = {
  bug: "Bug", feature: "Feature", task: "Task", question: "Frage",
};
const KIND_ICON: Record<TicketKind, typeof Bug> = {
  bug: Bug, feature: Sparkles, task: CheckSquare, question: HelpCircle,
};

const STATUSES: TicketStatus[] = ["open", "in_progress", "blocked", "resolved", "closed"];
const STATUS_META: Record<TicketStatus, { label: string; text: string; dot: string; icon: typeof Check }> = {
  open: { label: "Offen", text: "text-amber-300", dot: "bg-amber-400", icon: RotateCcw },
  in_progress: { label: "In Arbeit", text: "text-sky-300", dot: "bg-sky-400", icon: Play },
  blocked: { label: "Blockiert", text: "text-rose-300", dot: "bg-rose-400", icon: Ban },
  resolved: { label: "Gelöst", text: "text-emerald-300", dot: "bg-emerald-400", icon: Check },
  closed: { label: "Geschlossen", text: "text-muted-foreground", dot: "bg-zinc-500", icon: Archive },
};

const PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low"];
const PRIORITY_META: Record<TicketPriority, { label: string; text: string; dot: string }> = {
  urgent: { label: "Dringend", text: "text-rose-300", dot: "bg-rose-400" },
  high: { label: "Hoch", text: "text-amber-300", dot: "bg-amber-400" },
  medium: { label: "Mittel", text: "text-sky-300", dot: "bg-sky-400" },
  low: { label: "Niedrig", text: "text-muted-foreground", dot: "bg-zinc-500" },
};

const SEVERITIES: TicketSeverity[] = ["minor", "major", "critical"];
const SEVERITY_LABEL: Record<TicketSeverity, string> = {
  minor: "Gering", major: "Schwer", critical: "Kritisch",
};

const ACTOR_LABEL: Record<ActivityActor, string> = {
  human: "Mensch", autopilot: "Autopilot", system: "System",
};

const fmt = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

/** Compact German relative time for the card corner. */
function relTime(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tg`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

async function apiError(r: Response): Promise<string> {
  return (await r.json().catch(() => ({}))).error || "Fehler";
}

export function TicketsBoard() {
  const [filter, setFilter] = useState<"all" | TicketStatus>("all");
  const [kindFilter, setKindFilter] = useState<"all" | TicketKind>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TicketPriority>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Ticket | "new" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/tickets`, { cache: "no-store" }).then((r) => r.json());
      setTickets(d.tickets || []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<"all" | TicketStatus, number> = {
      all: tickets.length, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0,
    };
    for (const t of tickets) c[t.status]++;
    return c;
  }, [tickets]);

  const labels = useMemo(
    () => [...new Set(tickets.flatMap((t) => t.labels))].sort(),
    [tickets],
  );
  const assignees = useMemo(
    () => [...new Set(tickets.map((t) => t.assignee).filter((a): a is string => Boolean(a)))].sort(),
    [tickets],
  );

  const q = search.trim().toLowerCase();
  const visible = tickets
    .filter((t) => filter === "all" || t.status === filter)
    .filter((t) => kindFilter === "all" || t.kind === kindFilter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .filter((t) => labelFilter === "all" || t.labels.includes(labelFilter))
    .filter((t) => assigneeFilter === "all" || t.assignee === assigneeFilter)
    .filter(
      (t) =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.ref.toLowerCase().includes(q),
    );

  const selected = selectedId ? tickets.find((t) => t.id === selectedId) ?? null : null;

  async function setStatus(id: string, status: TicketStatus) {
    const r = await fetch(`/api/tickets/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (r.ok) { toast.success(`Status: ${STATUS_META[status].label}`); load(); }
    else { toast.error(await apiError(r)); }
  }

  async function addComment(id: string, text: string): Promise<boolean> {
    const r = await fetch(`/api/tickets/${id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (r.ok) { toast.success("Kommentar hinzugefügt"); load(); return true; }
    toast.error(await apiError(r));
    return false;
  }

  async function remove(id: string) {
    if (!window.confirm("Ticket endgültig löschen?")) return;
    const r = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Gelöscht"); setSelectedId(null); load(); }
    else { toast.error(await apiError(r)); }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <ThemeToggle className="grid h-8 w-8 place-items-center rounded-md">
          <KeystoneGlyph size={32} />
        </ThemeToggle>
        <div className="leading-tight">
          <div className="text-sm font-extrabold tracking-wide" style={{ fontFamily: '"Archivo", sans-serif' }}>
            LEGACY<span className="font-semibold text-muted-foreground">&nbsp;AI</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tickets · Board</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> Neues Ticket</Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-[11px]">Alle ({counts.all})</TabsTrigger>
            <TabsTrigger value="open" className="text-[11px]">Offen ({counts.open})</TabsTrigger>
            <TabsTrigger value="in_progress" className="text-[11px]">In Arbeit ({counts.in_progress})</TabsTrigger>
            <TabsTrigger value="blocked" className="text-[11px]">Blockiert ({counts.blocked})</TabsTrigger>
            <TabsTrigger value="resolved" className="text-[11px]">Gelöst ({counts.resolved})</TabsTrigger>
            <TabsTrigger value="closed" className="text-[11px]">Geschlossen ({counts.closed})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Arten</SelectItem>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Prioritäten</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p].label}</SelectItem>)}
            </SelectContent>
          </Select>
          {labels.length > 0 && (
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Labels</SelectItem>
                {labels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {assignees.length > 0 && (
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Zuständigen</SelectItem>
                {assignees.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Suchen (Titel, Text, Ref) …"
            className="h-8 w-[220px] text-xs"
          />
        </div>

        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {tickets.length === 0
                ? "Noch keine Tickets. Lege eins an oder lass den Autopilot einen Fehler melden."
                : "Keine Tickets in diesem Filter."}
            </div>
          ) : (
            visible.map((t) => (
              <TicketCard key={t.id} ticket={t} onOpen={() => setSelectedId(t.id)} />
            ))
          )}
        </div>
      </div>

      {selected && (
        <TicketDetail
          ticket={selected}
          onClose={() => setSelectedId(null)}
          onStatus={(status) => setStatus(selected.id, status)}
          onComment={(text) => addComment(selected.id, text)}
          onEdit={() => setEditing(selected)}
          onDelete={() => remove(selected.id)}
        />
      )}

      {editing && (
        <TicketEditor
          ticket={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const p = PRIORITY_META[priority];
  return (
    <span className={`inline-flex items-center gap-1.5 ${p.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} /> {p.label}
    </span>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}

function TicketCard({ ticket: t, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const KindIcon = KIND_ICON[t.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-mono text-muted-foreground">{t.ref}</span>
        <span className="inline-flex items-center gap-1 font-mono uppercase tracking-wider text-muted-foreground">
          <KindIcon className="h-3.5 w-3.5" /> {KIND_LABEL[t.kind]}
        </span>
        <StatusBadge status={t.status} />
        <PriorityBadge priority={t.priority} />
        {t.origin === "autopilot" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Bot className="h-3 w-3" /> Autopilot
          </span>
        )}
        <span className="ml-auto font-mono text-muted-foreground">{relTime(t.createdAt)}</span>
      </div>

      <div className="mt-1.5 text-sm font-semibold">{t.title}</div>
      {t.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{t.body}</p>}

      {(t.labels.length > 0 || t.area || t.assignee) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {t.area && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground/80">
              {t.area}
            </span>
          )}
          {t.labels.map((l) => (
            <span key={l} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{l}</span>
          ))}
          {t.assignee && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <UserRound className="h-3 w-3" /> {t.assignee}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function TicketDetail({
  ticket: t,
  onClose,
  onStatus,
  onComment,
  onEdit,
  onDelete,
}: {
  ticket: Ticket;
  onClose: () => void;
  onStatus: (status: TicketStatus) => void;
  onComment: (text: string) => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const KindIcon = KIND_ICON[t.kind];

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submitComment() {
    const text = comment.trim();
    if (!text) return;
    setSending(true);
    try {
      if (await onComment(text)) setComment("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-border bg-card sm:rounded-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t.ref}
              <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                <KindIcon className="h-3.5 w-3.5" /> {KIND_LABEL[t.kind]}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight" style={{ fontFamily: '"Archivo", sans-serif' }}>
              {t.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.severity && <span>Severity: {SEVERITY_LABEL[t.severity]}</span>}
              {t.area && <span>Bereich: {t.area}</span>}
              {t.assignee && (
                <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" /> {t.assignee}</span>
              )}
              <span>Gemeldet von {t.reporter}</span>
              {t.origin === "autopilot" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px]">
                  <Bot className="h-3 w-3" /> Autopilot{t.sourceRun ? ` · ${t.sourceRun}` : ""}
                </span>
              )}
              <span className="font-mono">Erstellt {fmt(t.createdAt)}</span>
              {t.resolvedAt && <span className="font-mono">Gelöst {fmt(t.resolvedAt)}</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Schließen">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          {t.body ? (
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.body) }} />
          ) : (
            <p className="text-sm text-muted-foreground">Keine Beschreibung.</p>
          )}

          {t.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {t.labels.map((l) => (
                <span key={l} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{l}</span>
              ))}
            </div>
          )}

          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Aktivität ({t.activity.length})
            </div>
            <div className="space-y-2">
              {t.activity.map((a) => (
                <div key={a.id} className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {a.actor === "autopilot"
                      ? <Bot className="h-3.5 w-3.5" />
                      : a.actor === "system"
                        ? <StickyNote className="h-3.5 w-3.5" />
                        : <UserRound className="h-3.5 w-3.5" />}
                    <span className="font-medium text-foreground/80">{ACTOR_LABEL[a.actor]}</span>
                    <span className="inline-flex items-center gap-1 font-mono uppercase tracking-wider">
                      {a.kind === "comment" && <MessageSquare className="h-3 w-3" />}
                      {a.kind}
                    </span>
                    <span className="ml-auto font-mono">{fmt(a.ts)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{a.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={comment}
                onChange={(ev) => setComment(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); submitComment(); } }}
                placeholder="Kommentar hinzufügen …"
                className="h-9 text-sm"
              />
              <Button size="sm" onClick={submitComment} disabled={sending || !comment.trim()}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Kommentar hinzufügen
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
          {STATUSES.filter((s) => s !== t.status).map((s) => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            return (
              <Button key={s} size="sm" variant={s === "resolved" ? "default" : "outline"} onClick={() => onStatus(s)}>
                <Icon className="h-3.5 w-3.5" /> {meta.label}
              </Button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Bearbeiten</Button>
            <Button size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Löschen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketEditor({ ticket, onClose, onSaved }: { ticket: Ticket | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Ticket>>(
    ticket ?? { kind: "bug", title: "", body: "", priority: "medium", area: "", labels: [], assignee: "" },
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Ticket, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const labelsText = Array.isArray(f.labels) ? f.labels.join(", ") : ((f.labels as unknown as string) ?? "");

  async function save() {
    setSaving(true);
    try {
      const body = {
        kind: f.kind,
        title: f.title,
        body: f.body ?? "",
        priority: f.priority,
        severity: f.severity ?? "",
        area: f.area ?? "",
        assignee: f.assignee ?? "",
        labels: labelsText.split(",").map((l) => l.trim()).filter(Boolean),
      };
      const url = ticket ? `/api/tickets/${ticket.id}` : `/api/tickets`;
      const r = await fetch(url, {
        method: ticket ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { toast.success("Gespeichert"); onSaved(); }
      else { toast.error(await apiError(r)); }
    } finally {
      setSaving(false);
    }
  }

  const s = STATUS_META[(f.status as TicketStatus) ?? "open"];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-border bg-card sm:rounded-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <StickyNote className="h-4 w-4" />
          <div className="text-sm font-semibold">
            {ticket ? `${ticket.ref} bearbeiten` : "Neues Ticket"}
          </div>
          <span className={`ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider ${s.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-1.5">
            <Label>Titel</Label>
            <Input value={f.title ?? ""} onChange={(ev) => set("title", ev.target.value)} placeholder="z. B. Blog-Editor verliert Tags beim Speichern" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Art</Label>
              <Select value={f.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Priorität</Label>
              <Select value={f.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Severity <span className="text-muted-foreground">(Bugs)</span></Label>
              <Select value={f.severity ?? "none"} onValueChange={(v) => set("severity", v === "none" ? undefined : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {SEVERITIES.map((sv) => <SelectItem key={sv} value={sv}>{SEVERITY_LABEL[sv]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Bereich <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={f.area ?? ""} onChange={(ev) => set("area", ev.target.value)} placeholder="z. B. blog, gateway, deck" />
            </div>
            <div className="grid gap-1.5">
              <Label>Zuständig <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={f.assignee ?? ""} onChange={(ev) => set("assignee", ev.target.value)} placeholder="z. B. luis, autopilot" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Labels <span className="text-muted-foreground">(Komma-getrennt)</span></Label>
            <Input value={labelsText} onChange={(ev) => set("labels", ev.target.value)} placeholder="regression, ui, daten" />
          </div>
          <div className="grid gap-1.5">
            <Label>Beschreibung <span className="text-muted-foreground">(Markdown)</span></Label>
            <Textarea rows={8} value={f.body ?? ""} onChange={(ev) => set("body", ev.target.value)} placeholder="Was ist kaputt / zu tun? Schritte, Erwartung, Beobachtung …" />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border p-4">
          <Button onClick={save} disabled={saving || !(f.title ?? "").trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Speichern
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={onClose}>Schließen</Button>
        </div>
      </div>
    </div>
  );
}
