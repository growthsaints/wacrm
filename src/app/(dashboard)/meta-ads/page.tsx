'use client';

// ============================================================
// Meta Ads — Custom Audiences built from CRM contact segments, for
// retargeting via Facebook/Instagram (Click-to-WhatsApp) ads.
// Campaign creation/launch isn't here yet — see lib/meta-ads/client.ts's
// header comment for why (Meta's current campaign schema for a
// WhatsApp-destination ad couldn't be confirmed against live docs from
// this environment, and guessing it risks real ad spend).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Megaphone, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CustomField, Tag } from '@/types';

type AudienceType = 'all' | 'tags' | 'custom_field';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface AudienceRow {
  id: string;
  name: string;
  audience_filter: { type: AudienceType };
  contact_count: number;
  status: 'pending' | 'creating' | 'ready' | 'failed';
  error_message: string | null;
  meta_audience_id: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<AudienceRow['status'], string> = {
  pending: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  creating: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  ready: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};

interface DraftState {
  name: string;
  type: AudienceType;
  tagIds: string[];
  customFieldId: string;
  customFieldOperator: CustomFieldOperator;
  customFieldValue: string;
}

function emptyDraft(): DraftState {
  return { name: '', type: 'all', tagIds: [], customFieldId: '', customFieldOperator: 'is', customFieldValue: '' };
}

export default function MetaAdsPage() {
  const { canEditSettings } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, audiencesRes, supabase] = [
        await fetch('/api/meta-ads/config', { cache: 'no-store' }),
        await fetch('/api/meta-ads/audiences', { cache: 'no-store' }),
        createClient(),
      ];
      const configData = await configRes.json().catch(() => ({}));
      setConnected(configRes.ok ? Boolean(configData.config) : false);

      const audiencesData = await audiencesRes.json().catch(() => ({}));
      if (audiencesRes.ok) setAudiences((audiencesData.audiences as AudienceRow[]) ?? []);

      const [{ data: tagRows }, { data: fieldRows }] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase.from('custom_fields').select('*').order('field_name'),
      ]);
      setTags(tagRows ?? []);
      setCustomFields(fieldRows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Polls while any audience is still 'creating' — the sync runs in
  // the background (after()), so this is how the row's status catches
  // up to 'ready'/'failed' without a manual refresh.
  useEffect(() => {
    if (!audiences.some((a) => a.status === 'creating')) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [audiences, load]);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Give the audience a name.');
      return;
    }
    if (draft.type === 'tags' && draft.tagIds.length === 0) {
      toast.error('Pick at least one tag.');
      return;
    }
    if (draft.type === 'custom_field' && (!draft.customFieldId || !draft.customFieldValue.trim())) {
      toast.error('Pick a custom field and a value.');
      return;
    }

    const audience_filter =
      draft.type === 'all'
        ? { type: 'all' as const }
        : draft.type === 'tags'
          ? { type: 'tags' as const, tagIds: draft.tagIds }
          : {
              type: 'custom_field' as const,
              customField: {
                fieldId: draft.customFieldId,
                operator: draft.customFieldOperator,
                value: draft.customFieldValue.trim(),
              },
            };

    setSaving(true);
    try {
      const res = await fetch('/api/meta-ads/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name.trim(), audience_filter }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the audience.");
        return;
      }
      toast.success('Audience created — syncing to Meta now.');
      setDraft(null);
      await load();
    } catch {
      toast.error("Couldn't create the audience.");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const resync = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/meta-ads/audiences/${id}/resync`, { method: 'POST' });
      if (!res.ok) {
        toast.error("Couldn't resync the audience.");
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm('Remove this audience from wacrm? It stays on Meta unless you also delete it in Ads Manager.'))
        return;
      const res = await fetch(`/api/meta-ads/audiences/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error("Couldn't remove the audience.");
        return;
      }
      await load();
    },
    [load],
  );

  const audienceSummary = useMemo(
    () => (row: AudienceRow) => {
      if (row.audience_filter.type === 'all') return 'All contacts';
      if (row.audience_filter.type === 'tags') return 'By tag';
      return 'By custom field';
    },
    [],
  );

  if (!canEditSettings) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <Megaphone className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only admins and owners can manage Meta Ads.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Meta Ads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build Custom Audiences from your CRM contacts to retarget them with Facebook/Instagram ads.
          </p>
        </div>
        {connected && (
          <Button onClick={() => setDraft(emptyDraft())}>
            <Plus className="mr-1 h-4 w-4" />
            New audience
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !connected ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No ad account connected yet.</p>
          <Link href="/settings?tab=meta-ads" className="mt-3 inline-block text-sm font-medium text-primary hover:text-primary/80">
            Connect one in Settings → Meta Ads →
          </Link>
        </div>
      ) : audiences.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No audiences yet. Create one from a contact segment to start retargeting on Meta.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {audiences.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{row.name}</span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                    {row.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {audienceSummary(row)} · {row.contact_count.toLocaleString()} contacts
                  {row.status === 'failed' && row.error_message ? ` · ${row.error_message}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => resync(row.id)}
                  disabled={row.status === 'creating'}
                  title="Resync from CRM"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(row.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Campaigns — coming soon</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Launching a Click-to-WhatsApp ad campaign directly from wacrm is next, once Meta&apos;s current
          campaign schema is confirmed.
        </p>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New audience</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Repeat customers Q1"
                  className="bg-muted text-foreground"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Who&apos;s in this audience?</label>
                <div className="flex gap-2">
                  {(['all', 'tags', 'custom_field'] as AudienceType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDraft({ ...draft, type: t })}
                      className={
                        draft.type === t
                          ? 'flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                          : 'flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
                      }
                    >
                      {t === 'all' ? 'All contacts' : t === 'tags' ? 'By tag' : 'By custom field'}
                    </button>
                  ))}
                </div>
              </div>

              {draft.type === 'tags' && (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                  {tags.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">No tags yet.</p>
                  ) : (
                    tags.map((tag) => (
                      <label key={tag.id} className="flex items-center gap-2 px-1 py-1 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={draft.tagIds.includes(tag.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              tagIds: e.target.checked
                                ? [...draft.tagIds, tag.id]
                                : draft.tagIds.filter((id) => id !== tag.id),
                            })
                          }
                        />
                        {tag.name}
                      </label>
                    ))
                  )}
                </div>
              )}

              {draft.type === 'custom_field' && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <select
                    value={draft.customFieldId}
                    onChange={(e) => setDraft({ ...draft, customFieldId: e.target.value })}
                    className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                  >
                    <option value="">Select a field…</option>
                    {customFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <select
                      value={draft.customFieldOperator}
                      onChange={(e) => setDraft({ ...draft, customFieldOperator: e.target.value as CustomFieldOperator })}
                      className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                    >
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                      <option value="contains">contains</option>
                    </select>
                    <Input
                      value={draft.customFieldValue}
                      onChange={(e) => setDraft({ ...draft, customFieldValue: e.target.value })}
                      placeholder="Value"
                      className="bg-muted text-foreground"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
