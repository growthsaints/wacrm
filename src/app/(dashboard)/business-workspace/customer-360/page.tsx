"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Briefcase,
  Loader2,
  Search,
  ShieldAlert,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CustomerProfile } from "@/lib/business-workspace/queries";

interface ContactSearchResult {
  id: string;
  name: string | null;
  phone: string;
}

function RiskBadge({ level }: { level: CustomerProfile["riskLevel"] }) {
  const cls =
    level === "high"
      ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
      : level === "medium"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  return (
    <Badge className={cn(cls)}>
      <ShieldAlert className="size-3" /> {level} risk
    </Badge>
  );
}

function ContactPicker({ onPick }: { onPick: (id: string) => void }) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const like = `%${query.trim()}%`;
      const { data } = await supabase
        .from("contacts")
        .select("id, name, phone")
        .or(`name.ilike.${like},phone.ilike.${like}`)
        .limit(10);
      setResults((data as ContactSearchResult[]) ?? []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Find a Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone…"
            className="pl-8"
          />
        </div>
        {searching && <Loader2 className="size-4 animate-spin text-primary" />}
        {results.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => onPick(r.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="text-foreground">{r.name || "Unnamed"}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Customer360Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contact");

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  function load() {
    if (!contactId) return;
    setLoading(true);
    fetch(`/api/business-workspace/customer-360/${contactId}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        if (res.status === 404) {
          toast.error("Customer not found.");
          router.push("/business-workspace/customer-360");
          return;
        }
        const json = await res.json();
        setProfile(json.profile ?? null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleAddNote() {
    if (!contactId || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/business-workspace/customer-360/${contactId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: noteText.trim() }),
      });
      if (!res.ok) {
        toast.error("Failed to add note.");
        return;
      }
      setNoteText("");
      load();
    } finally {
      setSavingNote(false);
    }
  }

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Customer 360 isn&apos;t enabled for your account.
      </p>
    );
  }

  if (!contactId) {
    return <ContactPicker onPick={(id) => router.push(`/business-workspace/customer-360?contact=${id}`)} />;
  }

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push("/business-workspace/customer-360")}>
          <Search className="size-4" /> Search another customer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>{profile.name || "Unnamed"}</span>
            <div className="flex items-center gap-2">
              <RiskBadge level={profile.riskLevel} />
              {profile.customerScore !== null && (
                <Badge variant="secondary">
                  <Star className="size-3" /> Score {profile.customerScore}
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="font-mono text-sm text-foreground">{profile.phone}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm text-foreground">{profile.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lead Source</p>
            <p className="text-sm text-foreground">{profile.source ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Assigned Agent</p>
            <p className="text-sm text-foreground">{profile.assignedAgentName ?? "Unassigned"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <p className="text-sm text-foreground capitalize">{profile.priority ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-sm text-foreground capitalize">{profile.workspaceStatus ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Segment</p>
            <p className="text-sm text-foreground">{profile.segment ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last Activity</p>
            <p className="text-sm text-foreground">
              {profile.lastActivity ? new Date(profile.lastActivity).toLocaleString() : "No activity yet"}
            </p>
          </div>
        </CardContent>
        {profile.tags.length > 0 && (
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {profile.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: tag.color + "20", color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="size-4 text-primary" /> Deals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals yet.</p>
            ) : (
              <ul className="space-y-2">
                {profile.deals.map((deal) => (
                  <li key={deal.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{deal.title}</span>
                    <span className="text-muted-foreground">
                      {deal.currency ?? ""} {deal.value.toLocaleString()} ·{" "}
                      <span className="capitalize">{deal.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                className="flex-1"
              />
              <Button onClick={handleAddNote} disabled={savingNote || !noteText.trim()}>
                {savingNote ? <Loader2 className="size-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            {profile.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {profile.notes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-border p-2 text-sm">
                    <p className="text-foreground">{note.noteText}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity History</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {profile.timeline.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-foreground">{event.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {profile.notTrackedYet.map((label) => (
              <Badge key={label} variant="outline" className="text-muted-foreground">
                {label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
