"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { uploadAccountMedia, MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import type { CampaignPlanRow } from "@/lib/business-workspace/queries";

const STATUSES = ["draft", "in_review", "approved", "scheduled", "completed", "cancelled"];

export default function CampaignPlannerPage() {
  const [plans, setPlans] = useState<CampaignPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [name, setName] = useState("");
  const [audienceSegment, setAudienceSegment] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/business-workspace/campaign-planner")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setPlans(json.rows ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Give the campaign a name.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/business-workspace/campaign-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), audienceSegment: audienceSegment || null, contentDraft: contentDraft || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to create.");
        return;
      }
      toast.success("Plan created.");
      setName("");
      setAudienceSegment("");
      setContentDraft("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/business-workspace/campaign-planner/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/business-workspace/campaign-planner/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  async function setMediaUrl(id: string, mediaUrl: string | null) {
    const res = await fetch(`/api/business-workspace/campaign-planner/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaUrl }),
    });
    if (res.ok) load();
  }

  function triggerUpload(planId: string) {
    setUploadTargetId(planId);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const planId = uploadTargetId;
    e.target.value = "";
    if (!file || !planId) return;
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error("File is too large (max 16 MB).");
      return;
    }
    setUploadingFor(planId);
    try {
      const { publicUrl } = await uploadAccountMedia("campaign-media", file);
      await setMediaUrl(planId, publicUrl);
      toast.success("Media attached.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingFor(null);
      setUploadTargetId(null);
    }
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
        Campaign Planner isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/3gpp,application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />
      <p className="text-xs text-muted-foreground">
        Planning only — drafting, audience notes, and internal approval.
        Nothing here sends a message; when a plan is ready, build the actual
        broadcast from Broadcasts using this plan as your brief.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Campaign Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Campaign Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali Sale 2026" />
            </div>
            <div>
              <Label className="mb-1.5 block">Audience Segment</Label>
              <Input value={audienceSegment} onChange={(e) => setAudienceSegment(e.target.value)} placeholder="VIP customers, last 90 days" />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Content Draft</Label>
            <Textarea value={contentDraft} onChange={(e) => setContentDraft(e.target.value)} rows={3} placeholder="Draft message copy…" />
          </div>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Plan
          </Button>
        </CardContent>
      </Card>

      {plans.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No campaign plans yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{plan.name}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => remove(plan.id)} aria-label="Delete plan">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {plan.audienceSegment && (
                  <p className="text-xs text-muted-foreground">Audience: {plan.audienceSegment}</p>
                )}
                {plan.contentDraft && <p className="text-sm text-foreground">{plan.contentDraft}</p>}

                {plan.mediaUrl ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                    <a
                      href={plan.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs text-primary underline"
                    >
                      {plan.mediaUrl.split("/").pop()}
                    </a>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      onClick={() => setMediaUrl(plan.id, null)}
                      aria-label="Remove media"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerUpload(plan.id)}
                    disabled={uploadingFor === plan.id}
                  >
                    {uploadingFor === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageUp className="h-3.5 w-3.5" />
                    )}
                    Attach Media
                  </Button>
                )}

                <div className="flex items-center justify-between pt-1">
                  <Select value={plan.status} onValueChange={(v) => v && updateStatus(plan.id, v)}>
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge
                    className={cn(
                      plan.status === "approved" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                      plan.status === "cancelled" && "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
                    )}
                    variant="outline"
                  >
                    {new Date(plan.createdAt).toLocaleDateString()}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
