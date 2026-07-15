"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, LifeBuoy, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Floating "chat with support" bubble — Growth Saints' own in-app
 * product assistant (see /api/support/chat + lib/ai/support-assistant),
 * not the tenant's own customer-facing AI agent. Mounted once in the
 * dashboard shell so it's available from every authenticated page.
 */
export function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, loading]);

  async function handleSend() {
    const content = input.trim();
    if (!content || loading) return;

    const next = [...turns, { role: "user" as const, content }];
    setTurns(next);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data?.code === "not_configured"
            ? "Support chat isn't set up yet — use \"Talk to Support\" below instead."
            : data?.error || "Something went wrong. Please try again.",
        );
        return;
      }
      setTurns((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
    } catch {
      setError("Couldn't reach support chat. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <div
          className={cn(
            "flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-md",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Growth Saints Support</p>
                <p className="text-xs leading-tight text-muted-foreground">Ask about using the CRM</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Close support chat"
            >
              <X />
            </Button>
          </div>

          <ScrollArea className="flex-1 px-4 py-3">
            <div ref={scrollRef} className="flex max-h-[19rem] flex-col gap-3 overflow-y-auto">
              {turns.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Hi! Ask me how to do something in the CRM — connecting WhatsApp,
                  sending broadcasts, setting up automations, and more.
                </p>
              )}
              {turns.map((turn, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    turn.role === "user"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-muted text-foreground",
                  )}
                >
                  {turn.content}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 self-start rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>
          </ScrollArea>

          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-border bg-card-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LifeBuoy className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="font-medium leading-tight">Talk to Support</p>
              <p className="text-xs leading-tight text-muted-foreground">Chat with our team on WhatsApp</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>

          <div className="flex items-end gap-2 border-t border-border p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a question…"
              rows={1}
              className="max-h-24 min-h-9 resize-none"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send"
            >
              <Send />
            </Button>
          </div>
        </div>
      )}

      <Button
        type="button"
        size="icon-lg"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        className="h-12 w-12 rounded-full shadow-lg"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>
    </div>
  );
}
