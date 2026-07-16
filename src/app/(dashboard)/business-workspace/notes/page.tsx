"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, StickyNote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { NotesListRow } from "@/lib/business-workspace/queries";

export default function BusinessWorkspaceNotesPage() {
  const [rows, setRows] = useState<NotesListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/business-workspace/notes?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setRows(json.rows ?? []);
        setTotalCount(json.totalCount ?? 0);
      })
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Notes isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes…"
          className="pl-8"
        />
      </div>

      <p className="text-xs text-muted-foreground">{totalCount.toLocaleString()} notes across every customer</p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No notes match this search.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((note) => (
            <Card key={note.id}>
              <CardContent className="flex items-start justify-between gap-3 py-3">
                <div className="flex items-start gap-2">
                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm text-foreground">{note.noteText}</p>
                    <Link
                      href={`/business-workspace/customer-360?contact=${note.contactId}`}
                      className="mt-1 inline-block text-xs text-muted-foreground hover:text-primary"
                    >
                      {note.contactName ?? note.contactPhone ?? "Unknown contact"}
                    </Link>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(note.createdAt).toLocaleString()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
