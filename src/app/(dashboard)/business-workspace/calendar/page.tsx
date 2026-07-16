"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScheduledItemRow } from "@/lib/business-workspace/queries";

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function CalendarPage() {
  const [rows, setRows] = useState<ScheduledItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ from: startOfMonth(), to: endOfMonth() });
    fetch(`/api/business-workspace/calendar?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setRows(json.rows ?? []);
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
  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Calendar isn&apos;t enabled for your account.
      </p>
    );
  }

  const grouped = rows.reduce<Record<string, ScheduledItemRow[]>>((acc, item) => {
    const day = new Date(item.dueAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    (acc[day] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        This month&apos;s meetings, appointments, callbacks, events, birthdays,
        and reminders — create or edit them from Follow-up Center.
      </p>
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nothing scheduled this month.</p>
      ) : (
        Object.entries(grouped).map(([day, items]) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-sm">{day}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{item.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {item.itemType.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.dueAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
