"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Search,
  Copy,
  Download,
  Upload,
} from "lucide-react";

import { useTranslations } from "next-intl";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: string;
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS = (t: ReturnType<typeof useTranslations>): Record<FlowRow["status"], string> => ({
  draft: t("statusDraft"),
  active: t("statusActive"),
  archived: t("statusArchived"),
});

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-border bg-muted text-muted-foreground",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-border bg-muted/50 text-muted-foreground",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan("send-messages");
  const t = useTranslations("Flows.list");
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch("/api/flows"),
          fetch("/api/flows/templates"),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t("loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword",
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error(t("createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("cloneError");
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(t("deleteConfirm", { name: flow.name }));
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t("deleteSuccess"));
    } catch (err) {
      console.error(err);
      toast.error(t("deleteError"));
    }
  }

  // Part 9 — Duplicate: fetch the source flow's full node graph, then
  // create a new draft flow with the same trigger + nodes rather than
  // just the header (a "duplicate" that dropped the graph wouldn't be
  // useful).
  async function handleDuplicate(flow: FlowRow) {
    setDuplicatingId(flow.id);
    try {
      const res = await fetch(`/api/flows/${flow.id}`);
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const { flow: source, nodes } = (await res.json()) as {
        flow: FlowRow & { trigger_config: Record<string, unknown>; entry_node_id: string | null };
        nodes: Array<{ node_key: string; node_type: string; config: Record<string, unknown>; position_x: number; position_y: number }>;
      };
      const createRes = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("duplicateName", { name: source.name }),
          description: source.description,
          trigger_type: source.trigger_type,
          trigger_config: source.trigger_config,
        }),
      });
      if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
      const { flow: created } = (await createRes.json()) as { flow: FlowRow };

      if (nodes.length > 0) {
        await fetch(`/api/flows/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_node_id: source.entry_node_id, nodes }),
        });
      }
      setFlows((prev) => [created, ...prev]);
      toast.success(t("duplicateSuccess"));
    } catch (err) {
      console.error(err);
      toast.error(t("duplicateError"));
    } finally {
      setDuplicatingId(null);
    }
  }

  // Part 9 — Export: a plain JSON download of the flow + node graph,
  // re-importable via handleImport below.
  async function handleExport(flow: FlowRow) {
    try {
      const res = await fetch(`/api/flows/${flow.id}`);
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-${flow.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(t("exportError"));
    }
  }

  // Part 9 — Import: the inverse of Export. Creates a new draft flow
  // from a previously-exported JSON file.
  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        flow: { name: string; description: string | null; trigger_type: string; trigger_config: Record<string, unknown>; entry_node_id: string | null };
        nodes: Array<{ node_key: string; node_type: string; config: Record<string, unknown>; position_x: number; position_y: number }>;
      };
      const createRes = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: parsed.flow.name,
          description: parsed.flow.description,
          trigger_type: parsed.flow.trigger_type,
          trigger_config: parsed.flow.trigger_config,
        }),
      });
      if (!createRes.ok) {
        const json = await createRes.json().catch(() => ({}));
        throw new Error(json.error ?? `Create failed: ${createRes.status}`);
      }
      const { flow: created } = (await createRes.json()) as { flow: FlowRow };
      if (parsed.nodes?.length > 0) {
        await fetch(`/api/flows/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_node_id: parsed.flow.entry_node_id, nodes: parsed.nodes }),
        });
      }
      setFlows((prev) => [created, ...prev]);
      toast.success(t("importSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("importError");
      toast.error(msg);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const f of flows) if (f.category) set.add(f.category);
    return Array.from(set).sort();
  }, [flows]);

  const filteredFlows = useMemo(() => {
    let result = flows;
    if (categoryFilter !== "__all__") {
      result = result.filter((f) => f.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(q));
    }
    return result;
  }, [flows, search, categoryFilter]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              {t("beta")}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t("import")}
          </Button>
          <GatedButton
            canAct={canCreate}
            gateReason="create flows"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("newFlow")}
          </GatedButton>
        </div>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
          t={t}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="border-border bg-card pl-9 text-sm"
              />
            </div>
            {categories.length > 0 && (
              <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
                <SelectTrigger className="w-48 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("allCategories")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {filteredFlows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredFlows.map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  onEdit={() => router.push(`/flows/${flow.id}`)}
                  onDelete={() => handleDelete(flow)}
                  onDuplicate={() => handleDuplicate(flow)}
                  onExport={() => handleExport(flow)}
                  duplicating={duplicatingId === flow.id}
                  t={t}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="sm:max-w-4xl bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("createDesc")}
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("startTemplate")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((template) => {
                  const Icon = TEMPLATE_ICONS[template.icon] ?? FileText;
                  return (
                    <button
                      key={template.slug}
                      type="button"
                      onClick={() => handleUseTemplate(template.slug)}
                      disabled={creating}
                      className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-popover-foreground">
                        {template.name}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {template.description}
                      </span>
                      <span className="mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">
                        {t("nodeCount", { count: template.node_count })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("startBlank")}
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("placeholderName")}
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("createBlank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
  t,
}: {
  onCreate: () => void;
  canCreate: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        {t("emptyTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t("emptyDesc")}
      </p>
      <GatedButton
        canAct={canCreate}
        gateReason="create flows"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        {t("createFirst")}
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  duplicating,
  t,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  duplicating: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const triggerSummary = describeTrigger(flow, t);
  const StatusIcon =
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS(t)[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {t("runCount", { count: flow.execution_count })}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t("edit")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={duplicating}>
          {duplicating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {t("duplicate")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
          {t("export")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("delete")}
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow, t: ReturnType<typeof useTranslations>): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return t("triggerKeywordNone");
    return t("triggerKeyword", { keywords: keywords.join(", ") });
  }
  if (flow.trigger_type === "first_inbound_message") {
    return t("triggerFirstInbound");
  }
  if (flow.trigger_type === "manual") {
    return t("triggerManual");
  }
  // Milestone 4's unified-engine trigger types (tag_added, order_paid,
  // schedule, webhook, …) don't need a bespoke summary each — the raw
  // trigger_type reads fine as a fallback label.
  return flow.trigger_type.replace(/_/g, ' ');
}
