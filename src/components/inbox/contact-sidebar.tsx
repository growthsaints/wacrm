"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Conversation, Deal, ContactNote, Tag, Profile, Message } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  UserCircle,
  CircleDot,
  Megaphone,
  Sparkles,
  Loader2,
  Package,
  History,
  Image as ImageIcon,
  FileText,
  Mic,
  Video as VideoIcon,
  Images,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { conversationStatusOption } from "@/lib/inbox/conversation-status";
import { contactSourceLabel } from "@/lib/contacts/source-label";
import { getContactCampaignSource, type CampaignSource } from "@/lib/contacts/campaign-source";
import { buildContactTimeline } from "@/lib/timeline/build-timeline";
import type { TimelineEvent } from "@/lib/timeline/types";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Optional — when provided, the sidebar shows Assigned Agent, Status,
   *  the AI suggestion panel, and the media gallery for this thread. */
  conversation?: Conversation | null;
}

type MediaFilter = "all" | "image" | "video" | "document" | "audio";

interface CommerceOrderSummary {
  id: string;
  order_number: string | null;
  status: string;
  total: number;
  currency: string;
  placed_at: string | null;
}

export function ContactSidebar({ contact, conversation = null }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [campaignSource, setCampaignSource] = useState<CampaignSource | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [mediaMessages, setMediaMessages] = useState<Message[]>([]);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [orders, setOrders] = useState<CommerceOrderSummary[]>([]);

  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    const [dealsRes, notesRes, tagsRes, campaignRes, timelineEvents, ordersRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      getContactCampaignSource(supabase, contact.id),
      buildContactTimeline(supabase, contact.id),
      supabase
        .from("commerce_orders")
        .select("id, order_number, status, total, currency, placed_at")
        .eq("contact_id", contact.id)
        .order("placed_at", { ascending: false })
        .limit(10),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    setCampaignSource(campaignRes);
    setTimeline(timelineEvents);
    if (ordersRes.data) setOrders(ordersRes.data as CommerceOrderSummary[]);
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  // Account roster — resolves the assigned agent's display name. Kept as
  // its own small query (mirrors message-thread.tsx's assign dropdown)
  // rather than lifted to a shared context, consistent with this app's
  // existing per-component data-fetching convention.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setProfiles(data as Profile[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Media gallery — pulls this conversation's image/video/document/audio
  // messages so the sidebar can offer the Media/Images/Videos/Documents/
  // Voice filters from Part 1 of the brief.
  useEffect(() => {
    if (!conversation) {
      setMediaMessages([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .in("content_type", ["image", "video", "document", "audio"])
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setMediaMessages(data as Message[]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleGetSuggestion = useCallback(async () => {
    if (!conversation || suggesting) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          toast.error(tSidebar("aiNotConfigured"));
        } else {
          toast.error(data.error ?? tSidebar("suggestionFailed"));
        }
        return;
      }
      const draft = typeof data.draft === "string" ? data.draft.trim() : "";
      setSuggestion(draft || null);
    } catch {
      toast.error(tSidebar("suggestionFailed"));
    } finally {
      setSuggesting(false);
    }
  }, [conversation, suggesting, tSidebar]);

  const handleCopySuggestion = useCallback(async () => {
    if (!suggestion) return;
    await navigator.clipboard.writeText(suggestion);
    toast.success(tSidebar("suggestionCopied"));
  }, [suggestion, tSidebar]);

  const assignedAgent = useMemo(() => {
    if (!conversation?.assigned_agent_id) return null;
    return profiles.find((p) => p.user_id === conversation.assigned_agent_id) ?? null;
  }, [conversation?.assigned_agent_id, profiles]);

  const filteredMedia = useMemo(() => {
    if (mediaFilter === "all") return mediaMessages;
    return mediaMessages.filter((m) => m.content_type === mediaFilter);
  }, [mediaMessages, mediaFilter]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();
  const statusOption = conversation ? conversationStatusOption(conversation.status) : null;

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Conversation status + assigned agent */}
          {conversation && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <CircleDot className="h-3 w-3" />
                  {tSidebar("conversationStatus")}
                </div>
                <p className={cn("mt-1 truncate text-xs font-medium", statusOption?.color ?? "text-foreground")}>
                  {statusOption?.label ?? conversation.status}
                </p>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <UserCircle className="h-3 w-3" />
                  {tSidebar("assignedAgent")}
                </div>
                <p className="mt-1 truncate text-xs font-medium text-foreground">
                  {assignedAgent?.full_name ?? tSidebar("unassigned")}
                </p>
              </div>
            </div>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Lead source / Campaign source */}
          <div className="grid grid-cols-1 gap-2">
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Megaphone className="h-3.5 w-3.5" />
                {tSidebar("leadSource")}
              </span>
              <span className="truncate text-xs font-medium text-foreground">
                {contactSourceLabel(contact.source)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Megaphone className="h-3.5 w-3.5" />
                {tSidebar("campaignSource")}
              </span>
              <span className="truncate text-xs font-medium text-foreground">
                {campaignSource?.broadcastName ?? tSidebar("noCampaignSource")}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* AI Suggested Reply */}
          {conversation && (
            <>
              <div>
                <div className="flex items-center justify-between px-1">
                  <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    {tSidebar("aiSuggestion")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={handleGetSuggestion}
                    disabled={suggesting}
                  >
                    {suggesting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      tSidebar("getSuggestion")
                    )}
                  </Button>
                </div>
                {suggestion && (
                  <div className="mt-2 rounded-lg bg-muted px-3 py-2">
                    <p className="whitespace-pre-wrap text-xs text-foreground">{suggestion}</p>
                    <button
                      onClick={handleCopySuggestion}
                      className="mt-1.5 text-[10px] font-medium text-primary hover:underline"
                    >
                      {tSidebar("copySuggestion")}
                    </button>
                  </div>
                )}
              </div>
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Order Information — real data once a WooCommerce/Shopify
              connection is synced (Milestone 4). Honest empty state
              when no orders exist for this contact yet. */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Package className="h-3 w-3" />
              {tSidebar("orderInformation")}
            </div>
            {orders.length === 0 ? (
              <p className="mt-2 px-1 text-xs text-muted-foreground">
                {tSidebar("orderInfoEmpty")}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="rounded-lg bg-muted px-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        {o.order_number ?? o.id.slice(0, 8)}
                      </span>
                      <span className="text-muted-foreground">
                        {o.currency} {o.total.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">{o.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes / Internal comments */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Media gallery */}
          {conversation && (
            <>
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Images className="h-3 w-3" />
                  {tSidebar("media")}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(
                    [
                      { value: "all", label: tSidebar("mediaAll") },
                      { value: "image", label: tSidebar("mediaImages") },
                      { value: "video", label: tSidebar("mediaVideos") },
                      { value: "document", label: tSidebar("mediaDocuments") },
                      { value: "audio", label: tSidebar("mediaVoice") },
                    ] as { value: MediaFilter; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setMediaFilter(f.value)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                        mediaFilter === f.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {filteredMedia.length === 0 ? (
                  <p className="mt-2 px-1 text-xs text-muted-foreground">{tSidebar("mediaEmpty")}</p>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {filteredMedia.map((m) => (
                      <MediaThumb key={m.id} message={m} />
                    ))}
                  </div>
                )}
              </div>

              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Conversation timeline */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <History className="h-3 w-3" />
              {tSidebar("timeline")}
            </div>
            {timeline.length === 0 ? (
              <p className="mt-2 px-1 text-xs text-muted-foreground">{tSidebar("noTimelineEvents")}</p>
            ) : (
              <ol className="mt-2 space-y-3 border-l border-border pl-3">
                {timeline.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[15.5px] top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <p className="text-xs text-foreground">{event.text}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(event.at), { addSuffix: true })}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function MediaThumb({ message }: { message: Message }) {
  if (message.content_type === "image" && message.media_url) {
    return (
      <a
        href={message.media_url}
        target="_blank"
        rel="noreferrer"
        className="block aspect-square overflow-hidden rounded-md bg-muted"
      >
        <img src={message.media_url} alt="" className="h-full w-full object-cover" />
      </a>
    );
  }

  const Icon =
    message.content_type === "video"
      ? VideoIcon
      : message.content_type === "audio"
        ? Mic
        : message.content_type === "image"
          ? ImageIcon
          : FileText;

  return (
    <a
      href={message.media_url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/70"
    >
      <Icon className="h-5 w-5" />
    </a>
  );
}
