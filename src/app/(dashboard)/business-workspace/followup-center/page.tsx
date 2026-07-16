"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduledItemRow } from "@/lib/business-workspace/queries";

export default function FollowupCenterPage() {
  const [rows, setRows] = useState<ScheduledItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [itemType, setItemType] = useState("follow_up");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/business-workspace/followup-center")
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

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!title.trim() || !dueAt) {
      toast.error("Title and due date are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/business-workspace/followup-center", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), itemType, dueAt: new Date(dueAt).toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to create.");
        return;
      }
      toast.success("Added.");
      setTitle("");
      setDueAt("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function markComplete(id: string) {
    const res = await fetch(`/api/business-workspace/followup-center/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (res.ok) load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/business-workspace/followup-center/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

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
        Follow-up Center isn&apos;t enabled for your account.
      </p>
    );
  }

  const pending = rows.filter((r) => r.status === "pending");
  const completed = rows.filter((r) => r.status === "completed");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Reminder</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back about renewal" />
          </div>
          <div>
            <Label className="mb-1.5 block">Type</Label>
            <Select value={itemType} onValueChange={(v) => setItemType(v ?? "follow_up")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="follow_up">Follow-up</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block">Due</Label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="sm:col-span-4">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing pending.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pending.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1.5 capitalize">
                        {item.itemType.replace("_", " ")}
                      </Badge>
                      Due {new Date(item.dueAt).toLocaleString()}
                      {item.assignedToName && ` · ${item.assignedToName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => markComplete(item.id)}>
                      Mark Done
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(item.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {completed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completed ({completed.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {completed.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="line-through">{item.title}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => remove(item.id)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
