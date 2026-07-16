"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ConversationRow {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface MessageRow {
  id: string;
  direction: "inbound" | "outbound";
  content_text: string;
  created_at: string;
}

export default function PersonalInboxPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(() => {
    fetch("/api/business-workspace/whatsapp-personal/conversations")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setConversations(json.conversations ?? []);
      })
      .finally(() => setLoadingList(false));
  }, []);

  const loadMessages = useCallback((conversationId: string) => {
    setLoadingMessages(true);
    fetch(`/api/business-workspace/whatsapp-personal/conversations/${conversationId}/messages`)
      .then(async (res) => {
        const json = await res.json();
        setMessages(json.messages ?? []);
      })
      .finally(() => setLoadingMessages(false));
  }, []);

  useEffect(() => {
    loadConversations();
    pollRef.current = setInterval(loadConversations, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  async function handleSend() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/business-workspace/whatsapp-personal/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to send.");
        return;
      }
      setDraft("");
      loadMessages(selectedId);
      loadConversations();
    } finally {
      setSending(false);
    }
  }

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Personal Inbox isn&apos;t enabled for your account.
      </p>
    );
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-border lg:col-span-1">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">Conversations</p>
        </div>
        {loadingList ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No chats captured yet — messages sent to or from the connected
            number will show up here.
          </p>
        ) : (
          <div className="max-h-[32rem] divide-y divide-border overflow-y-auto">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-muted",
                  selectedId === c.id && "bg-muted",
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {c.displayName || `+${c.phoneNumber}`}
                  </span>
                  {c.unreadCount > 0 && <Badge variant="secondary">{c.unreadCount}</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">{c.lastMessageText ?? "—"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border lg:col-span-2">
        {!selected ? (
          <p className="px-3 py-16 text-center text-sm text-muted-foreground">
            Select a conversation to view messages.
          </p>
        ) : (
          <div className="flex h-[32rem] flex-col">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {selected.displayName || `+${selected.phoneNumber}`}
              </p>
              <p className="font-mono text-xs text-muted-foreground">+{selected.phoneNumber}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {loadingMessages ? (
                <Loader2 className="mx-auto size-5 animate-spin text-primary" />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[75%] rounded-lg px-3 py-1.5 text-sm",
                        m.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                      )}
                    >
                      <p>{m.content_text}</p>
                      <p className="mt-0.5 text-[10px] opacity-70">{new Date(m.created_at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border p-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button onClick={handleSend} disabled={sending || !draft.trim()} size="icon">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
