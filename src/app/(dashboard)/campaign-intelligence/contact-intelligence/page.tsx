"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContactIntelligenceRow } from "@/lib/enterprise/queries";

export default function ContactIntelligencePage() {
  const [data, setData] = useState<ContactIntelligenceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/contact-intelligence")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.contacts ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (notEnabled || !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Contact Intelligence isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Messages</TableHead>
            <TableHead>Conversations</TableHead>
            <TableHead>Customer Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No contacts yet.
              </TableCell>
            </TableRow>
          ) : (
            data.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <p className="font-medium text-foreground">{c.name ?? "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                </TableCell>
                <TableCell className="text-muted-foreground capitalize">{c.source ?? "unknown"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{c.messageCount}</TableCell>
                <TableCell className="tabular-nums">{c.conversationCount}</TableCell>
                <TableCell className="tabular-nums">{c.leadScore ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
