'use client';

// ============================================================
// Meta Ads — Custom Audiences built from CRM contact segments, and
// launching a Click-to-WhatsApp campaign targeting them. Every
// campaign this page creates lands PAUSED on Meta — see
// lib/meta-ads/client.ts's header comment for why (one field in the
// ad creative schema isn't independently ground-truth confirmed);
// review it in Ads Manager and activate manually when ready.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ImageIcon, Loader2, Megaphone, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { MEDIA_MAX_BYTES_BY_KIND, uploadAccountMedia } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

interface CampaignRow {
  id: string;
  name: string;
  page_name: string | null;
  daily_budget: number;
  currency: string;
  meta_campaign_id: string | null;
  status: 'draft' | 'launching' | 'paused' | 'active' | 'failed';
  error_message: string | null;
}

interface MetaPageOption {
  id: string;
  name: string;
}

const AUDIENCE_STATUS_STYLES: Record<AudienceRow['status'], string> = {
  pending: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  creating: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  ready: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const CAMPAIGN_STATUS_STYLES: Record<CampaignRow['status'], string> = {
  draft: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  launching: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  paused: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};

interface AudienceDraftState {
  name: string;
  type: AudienceType;
  tagIds: string[];
  customFieldId: string;
  customFieldOperator: CustomFieldOperator;
  customFieldValue: string;
}

function emptyAudienceDraft(): AudienceDraftState {
  return { name: '', type: 'all', tagIds: [], customFieldId: '', customFieldOperator: 'is', customFieldValue: '' };
}

type AdFormat = 'image' | 'video' | 'carousel';

interface CarouselCardDraft {
  imageUrl: string;
  headline: string;
  description: string;
}

interface CampaignDraftState {
  name: string;
  pageId: string;
  pageName: string;
  customAudienceId: string;
  dailyBudget: string;
  primaryText: string;
  adFormat: AdFormat;
  imageUrl: string;
  videoUrl: string;
  carouselCards: CarouselCardDraft[];
}

function emptyCampaignDraft(): CampaignDraftState {
  return {
    name: '',
    pageId: '',
    pageName: '',
    customAudienceId: '',
    dailyBudget: '',
    primaryText: '',
    adFormat: 'image',
    imageUrl: '',
    videoUrl: '',
    carouselCards: [
      { imageUrl: '', headline: '', description: '' },
      { imageUrl: '', headline: '', description: '' },
    ],
  };
}

export default function MetaAdsPage() {
  const { canEditSettings } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [pages, setPages] = useState<MetaPageOption[]>([]);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);

  const [audienceDraft, setAudienceDraft] = useState<AudienceDraftState | null>(null);
  const [savingAudience, setSavingAudience] = useState(false);

  const [campaignDraft, setCampaignDraft] = useState<CampaignDraftState | null>(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCardIndex, setUploadingCardIndex] = useState<number | null>(null);
  const cardInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, audiencesRes, campaignsRes, supabase] = [
        await fetch('/api/meta-ads/config', { cache: 'no-store' }),
        await fetch('/api/meta-ads/audiences', { cache: 'no-store' }),
        await fetch('/api/meta-ads/campaigns', { cache: 'no-store' }),
        createClient(),
      ];
      const configData = await configRes.json().catch(() => ({}));
      const isConnected = configRes.ok ? Boolean(configData.config) : false;
      setConnected(isConnected);

      const audiencesData = await audiencesRes.json().catch(() => ({}));
      if (audiencesRes.ok) setAudiences((audiencesData.audiences as AudienceRow[]) ?? []);

      const campaignsData = await campaignsRes.json().catch(() => ({}));
      if (campaignsRes.ok) setCampaigns((campaignsData.campaigns as CampaignRow[]) ?? []);

      const [{ data: tagRows }, { data: fieldRows }] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase.from('custom_fields').select('*').order('field_name'),
      ]);
      setTags(tagRows ?? []);
      setCustomFields(fieldRows ?? []);

      if (isConnected) {
        const pagesRes = await fetch('/api/meta-ads/pages', { cache: 'no-store' });
        const pagesData = await pagesRes.json().catch(() => ({}));
        if (pagesRes.ok) {
          setPages((pagesData.pages as MetaPageOption[]) ?? []);
          setPagesError(null);
        } else {
          setPages([]);
          setPagesError(typeof pagesData.error === 'string' ? pagesData.error : "Couldn't load Facebook Pages from Meta.");
        }
      } else {
        setPagesError(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Polls while an audience or campaign is still mid-flight — both
  // sync in the background (after()), so this is how their status
  // catches up without a manual refresh.
  useEffect(() => {
    const pending =
      audiences.some((a) => a.status === 'creating') || campaigns.some((c) => c.status === 'launching');
    if (!pending) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [audiences, campaigns, load]);

  const readyAudiences = useMemo(() => audiences.filter((a) => a.status === 'ready'), [audiences]);

  // ---- Audiences ----

  const saveAudience = useCallback(async () => {
    if (!audienceDraft) return;
    if (!audienceDraft.name.trim()) {
      toast.error('Give the audience a name.');
      return;
    }
    if (audienceDraft.type === 'tags' && audienceDraft.tagIds.length === 0) {
      toast.error('Pick at least one tag.');
      return;
    }
    if (audienceDraft.type === 'custom_field' && (!audienceDraft.customFieldId || !audienceDraft.customFieldValue.trim())) {
      toast.error('Pick a custom field and a value.');
      return;
    }

    const audience_filter =
      audienceDraft.type === 'all'
        ? { type: 'all' as const }
        : audienceDraft.type === 'tags'
          ? { type: 'tags' as const, tagIds: audienceDraft.tagIds }
          : {
              type: 'custom_field' as const,
              customField: {
                fieldId: audienceDraft.customFieldId,
                operator: audienceDraft.customFieldOperator,
                value: audienceDraft.customFieldValue.trim(),
              },
            };

    setSavingAudience(true);
    try {
      const res = await fetch('/api/meta-ads/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: audienceDraft.name.trim(), audience_filter }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the audience.");
        return;
      }
      toast.success('Audience created — syncing to Meta now.');
      setAudienceDraft(null);
      await load();
    } catch {
      toast.error("Couldn't create the audience.");
    } finally {
      setSavingAudience(false);
    }
  }, [audienceDraft, load]);

  const resyncAudience = useCallback(
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

  const removeAudience = useCallback(
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

  // ---- Campaigns ----

  const handleCampaignImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error('Image is too large (max 5 MB).');
      return;
    }
    setUploadingImage(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setCampaignDraft((d) => (d ? { ...d, imageUrl: publicUrl } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the image.");
    } finally {
      setUploadingImage(false);
    }
  }, []);

  const handleCampaignVideo = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      toast.error('Please choose a video file.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.video) {
      toast.error('Video is too large (max 16 MB).');
      return;
    }
    setUploadingVideo(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setCampaignDraft((d) => (d ? { ...d, videoUrl: publicUrl } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the video.");
    } finally {
      setUploadingVideo(false);
    }
  }, []);

  const handleCarouselCardImage = useCallback(async (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error('Image is too large (max 5 MB).');
      return;
    }
    setUploadingCardIndex(index);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setCampaignDraft((d) => {
        if (!d) return d;
        const carouselCards = d.carouselCards.map((card, i) => (i === index ? { ...card, imageUrl: publicUrl } : card));
        return { ...d, carouselCards };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the image.");
    } finally {
      setUploadingCardIndex(null);
    }
  }, []);

  const updateCarouselCard = useCallback((index: number, patch: Partial<CarouselCardDraft>) => {
    setCampaignDraft((d) => {
      if (!d) return d;
      const carouselCards = d.carouselCards.map((card, i) => (i === index ? { ...card, ...patch } : card));
      return { ...d, carouselCards };
    });
  }, []);

  const addCarouselCard = useCallback(() => {
    setCampaignDraft((d) =>
      d ? { ...d, carouselCards: [...d.carouselCards, { imageUrl: '', headline: '', description: '' }] } : d,
    );
  }, []);

  const removeCarouselCard = useCallback((index: number) => {
    setCampaignDraft((d) => (d ? { ...d, carouselCards: d.carouselCards.filter((_, i) => i !== index) } : d));
  }, []);

  const saveCampaign = useCallback(async () => {
    if (!campaignDraft) return;
    if (!campaignDraft.name.trim()) {
      toast.error('Give the campaign a name.');
      return;
    }
    if (!campaignDraft.pageId) {
      toast.error('Pick which Facebook Page (and its linked WhatsApp number) this ad should use.');
      return;
    }
    if (!campaignDraft.primaryText.trim()) {
      toast.error('Write the ad text.');
      return;
    }
    if (campaignDraft.adFormat === 'image' && !campaignDraft.imageUrl) {
      toast.error('Add an image — Meta requires one for this ad format.');
      return;
    }
    if (campaignDraft.adFormat === 'video' && !campaignDraft.videoUrl) {
      toast.error('Upload a video.');
      return;
    }
    if (campaignDraft.adFormat === 'carousel') {
      const validCards = campaignDraft.carouselCards.filter((c) => c.imageUrl && c.headline.trim());
      if (validCards.length < 2) {
        toast.error('Add at least 2 carousel cards, each with an image and headline.');
        return;
      }
    }
    const dailyBudget = Number(campaignDraft.dailyBudget);
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      toast.error('Enter a valid daily budget.');
      return;
    }

    setSavingCampaign(true);
    try {
      const res = await fetch('/api/meta-ads/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignDraft.name.trim(),
          page_id: campaignDraft.pageId,
          page_name: campaignDraft.pageName,
          custom_audience_id: campaignDraft.customAudienceId || undefined,
          daily_budget: dailyBudget,
          primary_text: campaignDraft.primaryText.trim(),
          ad_format: campaignDraft.adFormat,
          image_url: campaignDraft.adFormat === 'image' ? campaignDraft.imageUrl : undefined,
          video_url: campaignDraft.adFormat === 'video' ? campaignDraft.videoUrl : undefined,
          carousel_cards:
            campaignDraft.adFormat === 'carousel'
              ? campaignDraft.carouselCards
                  .filter((c) => c.imageUrl && c.headline.trim())
                  .map((c) => ({ image_url: c.imageUrl, headline: c.headline.trim(), description: c.description.trim() || undefined }))
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the campaign.");
        return;
      }
      toast.success('Campaign created — launching on Meta, PAUSED, now.');
      setCampaignDraft(null);
      await load();
    } catch {
      toast.error("Couldn't create the campaign.");
    } finally {
      setSavingCampaign(false);
    }
  }, [campaignDraft, load]);

  const [togglingCampaignId, setTogglingCampaignId] = useState<string | null>(null);

  const [insightsOpenId, setInsightsOpenId] = useState<string | null>(null);
  const [insightsById, setInsightsById] = useState<
    Record<string, { spend: number; reach: number; impressions: number; clicks: number } | 'loading' | 'error'>
  >({});

  const toggleInsights = useCallback(
    async (id: string) => {
      if (insightsOpenId === id) {
        setInsightsOpenId(null);
        return;
      }
      setInsightsOpenId(id);
      if (insightsById[id] && insightsById[id] !== 'error') return;
      setInsightsById((prev) => ({ ...prev, [id]: 'loading' }));
      try {
        const res = await fetch(`/api/meta-ads/campaigns/${id}/insights`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setInsightsById((prev) => ({ ...prev, [id]: 'error' }));
          toast.error(data.error ?? "Couldn't load insights.");
          return;
        }
        setInsightsById((prev) => ({ ...prev, [id]: data.insights }));
      } catch {
        setInsightsById((prev) => ({ ...prev, [id]: 'error' }));
        toast.error("Couldn't load insights.");
      }
    },
    [insightsOpenId, insightsById],
  );

  const toggleCampaignStatus = useCallback(
    async (id: string, nextStatus: 'active' | 'paused') => {
      setTogglingCampaignId(id);
      try {
        const res = await fetch(`/api/meta-ads/campaigns/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? "Couldn't update the campaign status.");
          return;
        }
        toast.success(nextStatus === 'active' ? 'Campaign activated on Meta.' : 'Campaign paused on Meta.');
        await load();
      } catch {
        toast.error("Couldn't update the campaign status.");
      } finally {
        setTogglingCampaignId(null);
      }
    },
    [load],
  );

  const removeCampaign = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          'Remove this campaign from wacrm? Any Campaign/Ad Set/Ad already created on Meta stays there (PAUSED) unless you also delete it in Ads Manager.',
        )
      )
        return;
      const res = await fetch(`/api/meta-ads/campaigns/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error("Couldn't remove the campaign.");
        return;
      }
      await load();
    },
    [load],
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Meta Ads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build Custom Audiences from your CRM contacts and launch Click-to-WhatsApp campaigns targeting
          them. New campaigns are always created <span className="font-medium text-foreground">paused</span>
          — review and activate them in Meta Ads Manager.
        </p>
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
      ) : (
        <>
          {/* Audiences */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Custom Audiences</h2>
              <Button size="sm" onClick={() => setAudienceDraft(emptyAudienceDraft())}>
                <Plus className="mr-1 h-4 w-4" />
                New audience
              </Button>
            </div>
            {audiences.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
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
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${AUDIENCE_STATUS_STYLES[row.status]}`}>
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
                        onClick={() => resyncAudience(row.id)}
                        disabled={row.status === 'creating'}
                        title="Resync from CRM"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeAudience(row.id)}
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Campaigns */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
              <Button size="sm" onClick={() => setCampaignDraft(emptyCampaignDraft())} disabled={pages.length === 0}>
                <Plus className="mr-1 h-4 w-4" />
                New campaign
              </Button>
            </div>
            {pagesError && (
              <p className="mb-3 text-xs text-destructive">
                Couldn&apos;t load Facebook Pages from Meta: {pagesError}
              </p>
            )}
            {!pagesError && pages.length === 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                No Facebook Pages found for the connected token — a Page (with a WhatsApp number linked to
                it in Business Manager) is required to launch a campaign.
              </p>
            )}
            {campaigns.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                No campaigns yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {campaigns.map((row) => {
                  const insights = insightsById[row.id];
                  return (
                  <li key={row.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-3">
                      <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{row.name}</span>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_STYLES[row.status]}`}>
                            {row.status}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {row.page_name ?? 'Page'} · {row.currency} {row.daily_budget}/day
                          {row.status === 'failed' && row.error_message ? ` · ${row.error_message}` : ''}
                        </p>
                      </div>
                      {(row.status === 'paused' || row.status === 'active') && (
                        <>
                          <Button variant="outline" size="sm" className="shrink-0" onClick={() => toggleInsights(row.id)}>
                            <BarChart3 className="mr-1 h-3.5 w-3.5" />
                            Insights
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={togglingCampaignId === row.id}
                            onClick={() => toggleCampaignStatus(row.id, row.status === 'active' ? 'paused' : 'active')}
                          >
                            {togglingCampaignId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : row.status === 'active' ? (
                              'Pause'
                            ) : (
                              'Activate'
                            )}
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeCampaign(row.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {insightsOpenId === row.id && (
                      <div className="mt-3 border-t border-border pt-3">
                        {insights === 'loading' || insights === undefined ? (
                          <p className="text-xs text-muted-foreground">Loading insights…</p>
                        ) : insights === 'error' ? (
                          <p className="text-xs text-destructive">Couldn&apos;t load insights from Meta.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Spent</p>
                              <p className="text-sm font-medium text-foreground">
                                {row.currency} {insights.spend.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Reach</p>
                              <p className="text-sm font-medium text-foreground">{insights.reach.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Impressions</p>
                              <p className="text-sm font-medium text-foreground">{insights.impressions.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Clicks</p>
                              <p className="text-sm font-medium text-foreground">{insights.clicks.toLocaleString()}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* New audience dialog */}
      <Dialog open={!!audienceDraft} onOpenChange={(o) => !o && setAudienceDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New audience</DialogTitle>
          </DialogHeader>
          {audienceDraft && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <Input
                  value={audienceDraft.name}
                  onChange={(e) => setAudienceDraft({ ...audienceDraft, name: e.target.value })}
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
                      onClick={() => setAudienceDraft({ ...audienceDraft, type: t })}
                      className={
                        audienceDraft.type === t
                          ? 'flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                          : 'flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
                      }
                    >
                      {t === 'all' ? 'All contacts' : t === 'tags' ? 'By tag' : 'By custom field'}
                    </button>
                  ))}
                </div>
              </div>

              {audienceDraft.type === 'tags' && (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                  {tags.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">No tags yet.</p>
                  ) : (
                    tags.map((tag) => (
                      <label key={tag.id} className="flex items-center gap-2 px-1 py-1 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={audienceDraft.tagIds.includes(tag.id)}
                          onChange={(e) =>
                            setAudienceDraft({
                              ...audienceDraft,
                              tagIds: e.target.checked
                                ? [...audienceDraft.tagIds, tag.id]
                                : audienceDraft.tagIds.filter((id) => id !== tag.id),
                            })
                          }
                        />
                        {tag.name}
                      </label>
                    ))
                  )}
                </div>
              )}

              {audienceDraft.type === 'custom_field' && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <select
                    value={audienceDraft.customFieldId}
                    onChange={(e) => setAudienceDraft({ ...audienceDraft, customFieldId: e.target.value })}
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
                      value={audienceDraft.customFieldOperator}
                      onChange={(e) =>
                        setAudienceDraft({ ...audienceDraft, customFieldOperator: e.target.value as CustomFieldOperator })
                      }
                      className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                    >
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                      <option value="contains">contains</option>
                    </select>
                    <Input
                      value={audienceDraft.customFieldValue}
                      onChange={(e) => setAudienceDraft({ ...audienceDraft, customFieldValue: e.target.value })}
                      placeholder="Value"
                      className="bg-muted text-foreground"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAudienceDraft(null)} disabled={savingAudience}>
              Cancel
            </Button>
            <Button onClick={saveAudience} disabled={savingAudience}>
              {savingAudience && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New campaign dialog */}
      <Dialog open={!!campaignDraft} onOpenChange={(o) => !o && setCampaignDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New campaign (Click-to-WhatsApp)</DialogTitle>
          </DialogHeader>
          {campaignDraft && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Campaign name</label>
                <Input
                  value={campaignDraft.name}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, name: e.target.value })}
                  placeholder="e.g. Repeat customers — August"
                  className="bg-muted text-foreground"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Facebook Page (its linked WhatsApp number receives the chats)
                </label>
                <select
                  value={campaignDraft.pageId}
                  onChange={(e) => {
                    const page = pages.find((p) => p.id === e.target.value);
                    setCampaignDraft({ ...campaignDraft, pageId: e.target.value, pageName: page?.name ?? '' });
                  }}
                  className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">Select a Page…</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Audience (optional)</label>
                <select
                  value={campaignDraft.customAudienceId}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, customAudienceId: e.target.value })}
                  className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">No Custom Audience (broad targeting)</option>
                  {readyAudiences.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.contact_count.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Daily budget (₹)</label>
                <Input
                  type="number"
                  min="1"
                  value={campaignDraft.dailyBudget}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, dailyBudget: e.target.value })}
                  placeholder="100"
                  className="bg-muted text-foreground"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Ad text</label>
                <Textarea
                  value={campaignDraft.primaryText}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, primaryText: e.target.value })}
                  placeholder="What the ad says…"
                  className="min-h-20 bg-muted text-foreground"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Ad format</label>
                <div className="flex gap-2">
                  {(['image', 'video', 'carousel'] as const).map((format) => (
                    <Button
                      key={format}
                      type="button"
                      size="sm"
                      variant={campaignDraft.adFormat === format ? 'default' : 'outline'}
                      onClick={() => setCampaignDraft({ ...campaignDraft, adFormat: format })}
                      className="capitalize"
                    >
                      {format}
                    </Button>
                  ))}
                </div>
              </div>

              {campaignDraft.adFormat === 'image' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Image — Meta requires one for this ad format</label>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleCampaignImage(f);
                      e.target.value = '';
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploadingImage} onClick={() => imageInputRef.current?.click()}>
                    {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload image
                  </Button>
                  {campaignDraft.imageUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={campaignDraft.imageUrl} alt="Ad preview" className="h-16 rounded-md border border-border object-cover" />
                    </div>
                  )}
                </div>
              )}

              {campaignDraft.adFormat === 'video' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Video (max 16 MB) — Meta processes it after upload, so launching may take a minute</label>
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleCampaignVideo(f);
                      e.target.value = '';
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploadingVideo} onClick={() => videoInputRef.current?.click()}>
                    {uploadingVideo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload video
                  </Button>
                  {campaignDraft.videoUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <video src={campaignDraft.videoUrl} className="h-16 rounded-md border border-border object-cover" muted />
                      <span className="text-xs text-muted-foreground">Video uploaded</span>
                    </div>
                  )}
                </div>
              )}

              {campaignDraft.adFormat === 'carousel' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Carousel cards (at least 2, each with an image and headline)</label>
                  <div className="flex flex-col gap-3">
                    {campaignDraft.carouselCards.map((card, index) => (
                      <div key={index} className="rounded-md border border-border p-2">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Card {index + 1}</span>
                          {campaignDraft.carouselCards.length > 2 && (
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeCarouselCard(index)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        <input
                          ref={(el) => {
                            cardInputRefs.current[index] = el;
                          }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleCarouselCardImage(index, f);
                            e.target.value = '';
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingCardIndex === index}
                            onClick={() => cardInputRefs.current[index]?.click()}
                          >
                            {uploadingCardIndex === index ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            Upload image
                          </Button>
                          {card.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={card.imageUrl} alt="" className="h-10 w-10 rounded-md border border-border object-cover" />
                          )}
                        </div>
                        <Input
                          className="mt-2 bg-muted text-foreground"
                          placeholder="Headline"
                          value={card.headline}
                          onChange={(e) => updateCarouselCard(index, { headline: e.target.value })}
                        />
                        <Input
                          className="mt-2 bg-muted text-foreground"
                          placeholder="Description (optional)"
                          value={card.description}
                          onChange={(e) => updateCarouselCard(index, { description: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addCarouselCard}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add card
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignDraft(null)} disabled={savingCampaign}>
              Cancel
            </Button>
            <Button onClick={saveCampaign} disabled={savingCampaign}>
              {savingCampaign && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Create (paused)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
