"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Send, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceResult, DepartmentRow, InternalMessageRow } from "@/lib/business-workspace/queries";

const GENERAL = "__general__";

function PresenceDot({ status }: { status: "online" | "away" | "offline" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        status === "online" && "bg-emerald-500",
        status === "away" && "bg-amber-500",
        status === "offline" && "bg-muted-foreground/40",
      )}
    />
  );
}

export default function TeamWorkspacePage() {
  const [data, setData] = useState<TeamWorkspaceResult | null>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);
  const [addMemberFor, setAddMemberFor] = useState<Record<string, string>>({});

  const [channel, setChannel] = useState(GENERAL);
  const [messages, setMessages] = useState<InternalMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDepartments = useCallback(() => {
    fetch("/api/business-workspace/departments")
      .then((res) => res.json())
      .then((json) => setDepartments(json.departments ?? []));
  }, []);

  useEffect(() => {
    fetch("/api/business-workspace/team-workspace")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json ?? null);
      })
      .finally(() => setLoading(false));
    loadDepartments();
  }, [loadDepartments]);

  const loadMessages = useCallback(() => {
    const params = channel === GENERAL ? "" : `?department=${channel}`;
    fetch(`/api/business-workspace/team-chat${params}`)
      .then((res) => res.json())
      .then((json) => setMessages(json.messages ?? []));
  }, [channel]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages]);

  async function handleCreateDepartment() {
    if (!newDeptName.trim()) return;
    setCreatingDept(true);
    try {
      const res = await fetch("/api/business-workspace/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDeptName.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to create department.");
        return;
      }
      setNewDeptName("");
      loadDepartments();
    } finally {
      setCreatingDept(false);
    }
  }

  async function handleDeleteDepartment(id: string) {
    const res = await fetch(`/api/business-workspace/departments/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (channel === id) setChannel(GENERAL);
      loadDepartments();
    }
  }

  async function handleAddMember(departmentId: string) {
    const userId = addMemberFor[departmentId];
    if (!userId) return;
    const res = await fetch(`/api/business-workspace/departments/${departmentId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setAddMemberFor((prev) => ({ ...prev, [departmentId]: "" }));
      loadDepartments();
    }
  }

  async function handleRemoveMember(departmentId: string, userId: string) {
    const res = await fetch(`/api/business-workspace/departments/${departmentId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) loadDepartments();
  }

  async function handleSendMessage() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/business-workspace/team-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: channel === GENERAL ? null : channel, text: draft.trim() }),
      });
      if (res.ok) {
        setDraft("");
        loadMessages();
      }
    } finally {
      setSending(false);
    }
  }

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
        Team Workspace isn&apos;t enabled for your account.
      </p>
    );
  }

  function memberName(userId: string): string {
    const m = data?.members.find((x) => x.userId === userId);
    return m ? m.fullName || m.email : userId;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster &amp; Availability</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Conversations Closed (7d)</TableHead>
                <TableHead>Deals Won (7d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.fullName || m.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {m.accountRole}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm capitalize text-muted-foreground">
                      <PresenceDot status={m.presenceStatus} /> {m.presenceStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{m.conversationsClosedThisWeek}</TableCell>
                  <TableCell className="text-sm text-foreground">{m.dealsWonThisWeek}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Departments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="e.g. Sales, Support"
              className="max-w-xs"
            />
            <Button onClick={handleCreateDepartment} disabled={creatingDept || !newDeptName.trim()}>
              {creatingDept ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add Department
            </Button>
          </div>

          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No departments yet — just the flat roster above.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {departments.map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{d.name}</p>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteDepartment(d.id)} aria-label="Delete department">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.memberIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No members yet.</span>
                    ) : (
                      d.memberIds.map((uid) => (
                        <Badge key={uid} variant="secondary" className="gap-1">
                          {memberName(uid)}
                          <button onClick={() => handleRemoveMember(d.id, uid)} aria-label="Remove member">
                            <UserMinus className="size-3" />
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Select
                      value={addMemberFor[d.id] ?? ""}
                      onValueChange={(v) => setAddMemberFor((prev) => ({ ...prev, [d.id]: v ?? "" }))}
                    >
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="Add a member…" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.members
                          .filter((m) => !d.memberIds.includes(m.userId))
                          .map((m) => (
                            <SelectItem key={m.userId} value={m.userId}>
                              {m.fullName || m.email}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon-sm" onClick={() => handleAddMember(d.id)} aria-label="Add">
                      <UserPlus className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Internal Chat</span>
            <Select value={channel} onValueChange={(v) => setChannel(v ?? GENERAL)}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL}>General</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet — say hello.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <span className="font-medium text-foreground">{m.senderName ?? "Unknown"}</span>{" "}
                  <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleTimeString()}</span>
                  <p className="text-foreground">{m.contentText}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the team…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <Button onClick={handleSendMessage} disabled={sending || !draft.trim()} size="icon">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.notTrackedYet.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.notTrackedYet.map((label) => (
            <Badge key={label} variant="outline" className="text-muted-foreground">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
