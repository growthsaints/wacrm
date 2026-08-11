'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
  Upload,
  BookOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { TemplatePreview } from './template-preview';
import { TemplateLibraryDialog } from './template-library-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateCard,
  TemplateSampleValues,
} from '@/types';
import { templateStatusConfig } from '@/lib/template-status';
import {
  CARD_LIMITS,
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = ['none', 'text', 'image', 'video', 'document'];

type HeaderMediaFormat = 'image' | 'video' | 'document';

// Matches Meta's accepted header-media formats per type. Sizes are
// enforced separately via MEDIA_MAX_BYTES_BY_KIND (our bucket's cap,
// which is lower than Meta's own limit for video/document — see that
// constant's comment).
const HEADER_MEDIA_ACCEPT: Record<HeaderMediaFormat, { mimeTypes: string[]; accept: string }> = {
  image: { mimeTypes: ['image/jpeg', 'image/png'], accept: 'image/jpeg,image/png' },
  video: { mimeTypes: ['video/mp4', 'video/3gpp'], accept: 'video/mp4,video/3gpp' },
  document: { mimeTypes: ['application/pdf'], accept: 'application/pdf' },
};

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

/**
 * Editing shape for a single carousel card — mirrors TemplateCard but
 * keeps body_samples as a plain string array (like the whole-template
 * form's body_samples) rather than the API's nested `sample_values`
 * object, so the same "one input per {{N}}" pattern works for cards.
 */
interface TemplateCardForm {
  header_format: 'image' | 'video';
  header_media_url: string;
  body_text: string;
  body_samples: string[];
  buttons: TemplateButton[];
}

function emptyCard(): TemplateCardForm {
  return { header_format: 'image', header_media_url: '', body_text: '', body_samples: [], buttons: [] };
}

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
  /** Non-empty means this is a Carousel template — see toggleCarousel(). */
  cards: TemplateCardForm[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
  cards: [],
};

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

export function TemplateManager() {
  const t = useTranslations('Settings.templates');
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  // Non-null when the dialog is editing an existing row — switches the
  // submit handler from POST /submit to PATCH /[id] and changes the
  // dialog title + CTA. Set to the template id to pre-fill from a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Template selected for the confirm-delete dialog. The destructive
  // action goes through this two-step so a slip on the trash icon
  // doesn't take the template off Meta as well as locally.
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  // Read-only full-content preview, opened by clicking a template
  // card. Distinct from the edit dialog so Pending/Rejected templates
  // (which have no Edit action) can still be inspected in full.
  const [viewingTemplate, setViewingTemplate] = useState<MessageTemplate | null>(null);
  // Header-image upload (issue #230). Uploads to the account-scoped
  // chat-media bucket and stores the public URL in header_media_url; the
  // submit route turns that into a Meta Resumable-Upload handle.
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);

  // Per-card media upload — one index at a time (Meta review still only
  // needs one in flight; the UI disables that card's button while its
  // own upload runs, other cards stay interactive).
  const [uploadingCardIndex, setUploadingCardIndex] = useState<number | null>(null);
  const cardFileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Body variable indices — `[1, 2, 3]` for "{{1}} {{2}} {{3}}". We
  // re-run the extractor on every render to keep the sample-value rows
  // in sync with what the user typed.
  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );

  // A non-empty `cards` array IS what makes this a Carousel template —
  // no separate boolean to keep in sync. Carousel is mutually exclusive
  // with the whole-template header/footer/buttons (Meta rule, enforced
  // server-side in validateCards()), so toggling it on/off also clears
  // those.
  const isCarousel = form.cards.length > 0;

  // Resize body_samples so it always has exactly bodyVarCount entries.
  // (We mutate via setForm in an effect so React owns the state.)
  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push('');
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchTemplates(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates(userId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      cards:
        form.cards.length > 0
          ? form.cards.map(
              (card): TemplateCard => ({
                header_format: card.header_format,
                header_media_url: card.header_media_url.trim() || undefined,
                body_text: card.body_text.trim(),
                buttons:
                  card.buttons.length > 0
                    ? (card.buttons as TemplateCard['buttons'])
                    : undefined,
                sample_values: card.body_samples.some((v) => v.trim())
                  ? { body: card.body_samples.map((v) => v.trim()) }
                  : undefined,
              }),
            )
          : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
      cards: (template.cards ?? []).map((card) => ({
        header_format: card.header_format,
        header_media_url: card.header_media_url ?? '',
        body_text: card.body_text,
        body_samples: card.sample_values?.body ?? [],
        buttons: card.buttons ?? [],
      })),
    });
    setDialogOpen(true);
  }

  function openView(template: MessageTemplate) {
    setViewingTemplate(template);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || `${isEdit ? 'Edit' : 'Submit'} failed (HTTP ${res.status})`,
        );
      }
      // Refresh first, then close — re-opening the dialog
      // immediately should not show a stale list.
      if (user) await fetchTemplates(user.id);
      toast.success(
        data.dry_run
          ? isEdit
            ? t('toastSaveEditDry')
            : t('toastSaveNewDry')
          : isEdit
            ? t('toastSubmitEditSuccess')
            : t('toastSubmitNewSuccess'),
      );
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : t('toastSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        t('toastSyncCount', { total: data.total }) +
          (data.inserted || data.updated
            ? t('toastSyncDetails', { inserted: data.inserted, updated: data.updated })
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(t('toastSyncFailed', { preview: preview.join(', ') + suffix }));
      }
      if (data.truncated) {
        // Use error (not warning) so the message survives long
        // enough to read — sonner's `warning` auto-dismisses on
        // the same short timer as `success`.
        toast.error(
          t('toastSyncTruncated'),
          { duration: 10000 },
        );
      }
      await fetchTemplates(user.id);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : t('toastSyncError'));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call.
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success(t('toastDeleteSuccess'));
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : t('toastDeleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };
  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      // Per-variant spread keeps the discriminant pinned. Switch
      // exhaustiveness is enforced by TypeScript.
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  function toggleCarousel(enabled: boolean) {
    setForm((prev) => ({
      ...prev,
      cards: enabled ? [emptyCard(), emptyCard()] : [],
      // Mutually exclusive with a carousel (Meta rule) — clear them
      // going in, and restore a sane default coming back out.
      header_format: enabled ? 'none' : prev.header_format,
      footer_text: enabled ? '' : prev.footer_text,
      buttons: enabled ? [] : prev.buttons,
    }));
  }

  function updateCard(index: number, patch: Partial<TemplateCardForm>) {
    setForm((prev) => {
      const next = [...prev.cards];
      next[index] = { ...next[index], ...patch };
      return { ...prev, cards: next };
    });
  }

  function addCard() {
    if (form.cards.length >= CARD_LIMITS.maxCards) return;
    setForm((prev) => ({ ...prev, cards: [...prev.cards, emptyCard()] }));
  }

  function removeCard(index: number) {
    if (form.cards.length <= CARD_LIMITS.minCards) return;
    setForm((prev) => ({ ...prev, cards: prev.cards.filter((_, i) => i !== index) }));
  }

  function addCardButton(cardIndex: number) {
    const card = form.cards[cardIndex];
    if (!card || card.buttons.length >= CARD_LIMITS.maxButtonsPerCard) return;
    updateCard(cardIndex, { buttons: [...card.buttons, emptyButton('QUICK_REPLY')] });
  }

  function removeCardButton(cardIndex: number, buttonIndex: number) {
    const card = form.cards[cardIndex];
    if (!card) return;
    updateCard(cardIndex, { buttons: card.buttons.filter((_, i) => i !== buttonIndex) });
  }

  function changeCardButtonType(
    cardIndex: number,
    buttonIndex: number,
    type: TemplateButton['type'],
  ) {
    const card = form.cards[cardIndex];
    if (!card) return;
    const next = [...card.buttons];
    next[buttonIndex] = emptyButton(type);
    updateCard(cardIndex, { buttons: next });
  }

  function updateCardButton(cardIndex: number, buttonIndex: number, patch: ButtonPatch) {
    const card = form.cards[cardIndex];
    if (!card) return;
    const current = card.buttons[buttonIndex];
    if (!current) return;
    const next = [...card.buttons];
    switch (current.type) {
      case 'QUICK_REPLY':
        next[buttonIndex] = { ...current, ...(patch.text !== undefined && { text: patch.text }) };
        break;
      case 'URL':
        next[buttonIndex] = {
          ...current,
          ...(patch.text !== undefined && { text: patch.text }),
          ...(patch.url !== undefined && { url: patch.url }),
          ...(patch.example !== undefined && { example: patch.example }),
        };
        break;
      case 'PHONE_NUMBER':
        next[buttonIndex] = {
          ...current,
          ...(patch.text !== undefined && { text: patch.text }),
          ...(patch.phone_number !== undefined && { phone_number: patch.phone_number }),
        };
        break;
    }
    updateCard(cardIndex, { buttons: next });
  }

  async function handleCardMediaFile(cardIndex: number, file: File) {
    const card = form.cards[cardIndex];
    if (!card) return;
    const kind = card.header_format;
    const { mimeTypes } = HEADER_MEDIA_ACCEPT[kind];
    if (!mimeTypes.includes(file.type)) {
      toast.error(
        t('toastInvalidFile', {
          format: kind,
          types: mimeTypes.map((m) => m.split('/')[1]).join(' / '),
        }),
      );
      return;
    }
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > maxBytes) {
      toast.error(
        t('toastFileTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          format: kind,
          limit: (maxBytes / 1024 / 1024).toFixed(0),
        }),
      );
      return;
    }
    setUploadingCardIndex(cardIndex);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      updateCard(cardIndex, { header_media_url: publicUrl });
      toast.success(t('toastUploadSuccess', { format: kind }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingCardIndex(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  async function handleHeaderMediaFile(file: File) {
    const kind = form.header_format as HeaderMediaFormat;
    const { mimeTypes } = HEADER_MEDIA_ACCEPT[kind];
    if (!mimeTypes.includes(file.type)) {
      toast.error(
        t('toastInvalidFile', {
          format: kind,
          types: mimeTypes.map((m) => m.split('/')[1]).join(' / '),
        }),
      );
      return;
    }
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > maxBytes) {
      toast.error(
        t('toastFileTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          format: kind,
          limit: (maxBytes / 1024 / 1024).toFixed(0),
        }),
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setForm((f) => ({ ...f, header_media_url: publicUrl }));
      toast.success(t('toastUploadSuccess', { format: kind }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingHeader(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSyncFromMeta}
              disabled={syncing}
              title={t('syncTitle')}
            >
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('syncing') : t('syncFromMeta')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setLibraryDialogOpen(true)}
              title={t('library.browseTitle')}
            >
              <BookOpen className="size-4" />
              {t('library.browseButton')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('newTemplate')}
            </Button>
          </div>
        }
      />

      <TemplateLibraryDialog
        open={libraryDialogOpen}
        onOpenChange={setLibraryDialogOpen}
        onCreated={(template) => {
          setTemplates((prev) => [template, ...prev.filter((tpl) => tpl.id !== template.id)]);
        }}
      />

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">{t('noTemplates')}</p>
            <p className="text-muted-foreground text-xs mt-1">
              {t('createFirst')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {templates.map((template) => {
            const statusKey = template.status || 'DRAFT';
            const status = templateStatusConfig[statusKey];
            return (
              <Card key={template.id}>
                <CardContent className="flex items-start justify-between pt-4">
                  <div
                    className="space-y-2 min-w-0 flex-1 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => openView(template)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openView(template);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{template.name}</h3>
                      <Badge
                        className={`text-xs border ${categoryColors[template.category] || ''}`}
                      >
                        {template.category}
                      </Badge>
                      <Badge className={`text-xs border ${status.classes}`}>
                        {status.label}
                      </Badge>
                      {template.language && (
                        <span className="text-xs text-muted-foreground uppercase">
                          {template.language}
                        </span>
                      )}
                      {template.quality_score && (
                        <span
                          className={`text-[10px] uppercase font-medium ${
                            template.quality_score === 'GREEN'
                              ? 'text-emerald-400'
                              : template.quality_score === 'YELLOW'
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}
                          title="Meta quality score"
                        >
                          {template.quality_score}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.body_text}
                    </p>
                    {template.footer_text && (
                      <p className="text-xs text-muted-foreground italic">
                        {template.footer_text}
                      </p>
                    )}
                    {(template.rejection_reason || template.submission_error) && (
                      <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded px-2 py-1.5">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          {template.rejection_reason || template.submission_error}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {statusKey === 'APPROVED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title={t('editTitle')}
                        aria-label={t('editLabel')}
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <Pencil className="size-3.5" />
                        {t('edit')}
                      </Button>
                    )}
                    {(statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title={t('resubmitTitle')}
                        aria-label={t('resubmitLabel')}
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <RotateCcw className="size-3.5" />
                        {t('resubmit')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTemplateToDelete(template)}
                      disabled={deletingId === template.id}
                      aria-label={
                        template.meta_template_id
                          ? t('deleteMetaLocallyAria')
                          : t('deleteLocallyAria')
                      }
                      title={
                        template.meta_template_id
                          ? t('deleteMetaLocallyTitle')
                          : t('deleteLocallyTitle')
                      }
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-8 w-8"
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-2xl lg:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editingId ? t('dialogEditTitle') : t('dialogNewTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId
                ? t('dialogEditDesc')
                : t('dialogNewDesc')}
            </DialogDescription>
          </DialogHeader>

          {form.category === 'Authentication' && (
            <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <p>{t.rich('authWarning', { bold: (chunks) => <strong>{chunks}</strong> })}</p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('templateName')}</Label>
              <Input
                placeholder={t('namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingId !== null}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <p className="text-[11px] text-muted-foreground">
                {editingId
                  ? t('nameFixed')
                  : t('nameHint')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('category')}</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {CATEGORIES.map((cat) => (
                      <SelectItem
                        key={cat}
                        value={cat}
                        className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                      >
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('language')}</Label>
                <Input
                  list="template-language-codes"
                  placeholder="en_US"
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value })
                  }
                  disabled={editingId !== null}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <datalist id="template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <p className="text-[11px] text-muted-foreground">
                  {editingId ? (
                    t('langFixed')
                  ) : (
                    <span>{t.rich('langHint', { code: (chunks) => <code>{chunks}</code> })}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
              <div>
                <Label className="text-foreground">{t('carouselToggle')}</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('carouselToggleDesc')}
                </p>
              </div>
              <Button
                type="button"
                variant={isCarousel ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleCarousel(!isCarousel)}
                className={isCarousel ? '' : 'border-border bg-transparent text-muted-foreground hover:bg-muted'}
              >
                {isCarousel ? t('carouselOn') : t('carouselOff')}
              </Button>
            </div>

            {!isCarousel && (
            <>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('header')}</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) =>
                  // Preserve header_content, header_media_url, and
                  // header_sample across format switches. The submit
                  // payload builder only reads the field that matches
                  // the active format, so an orphan value on a hidden
                  // field is harmless — and keeping it lets the user
                  // switch formats to compare without losing typing.
                  setForm({
                    ...form,
                    header_format: (val || 'none') as HeaderFormat,
                  })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {type === 'none'
                        ? t('headerNone')
                        : type === 'text'
                          ? t('headerText')
                          : type === 'image'
                            ? t('headerImage')
                            : type === 'video'
                              ? t('headerVideo')
                              : t('headerDocument')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' && (
                <div className="space-y-2 mt-2">
                  <Input
                    id="template-header-text"
                    aria-label="Header text"
                    placeholder={t('headerTextPlaceholder')}
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {headerVarCount > 0 && (
                    <Input
                      id="template-header-sample"
                      aria-label={t('headerSampleAria')}
                      placeholder={t('headerSamplePlaceholder')}
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {headerNeedsMedia && (
                <div className="space-y-2 mt-2">
                  {(form.header_format === 'image' ||
                    form.header_format === 'video' ||
                    form.header_format === 'document') && (
                    <div className="flex items-center gap-2">
                      <input
                        ref={headerFileRef}
                        type="file"
                        accept={HEADER_MEDIA_ACCEPT[form.header_format].accept}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleHeaderMediaFile(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingHeader}
                        onClick={() => headerFileRef.current?.click()}
                      >
                        {uploadingHeader ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {form.header_format === 'image'
                          ? t('uploadImage')
                          : form.header_format === 'video'
                            ? t('uploadVideo')
                            : t('uploadDocument')}
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        {form.header_format === 'image'
                          ? t('uploadHint')
                          : form.header_format === 'video'
                            ? t('uploadHintVideo')
                            : t('uploadHintDocument')}
                      </span>
                    </div>
                  )}
                  <Input
                    placeholder={t('mediaUrlPlaceholder', { format: form.header_format })}
                    value={form.header_media_url}
                    onChange={(e) =>
                      setForm({ ...form, header_media_url: e.target.value })
                    }
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {form.header_format === 'image' && form.header_media_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.header_media_url}
                      alt="Header sample"
                      className="max-h-28 rounded-md border border-border object-contain"
                    />
                  )}
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {form.header_format === 'image'
                      ? t('imageHint')
                      : t('mediaHint')}
                    {form.header_format === 'video' &&
                      t('videoHint')}
                    {form.header_format === 'document' &&
                      t('documentHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('bodyText')}</Label>
              <Textarea
                placeholder={t('bodyPlaceholder')}
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('bodyHint')}
              </p>

              {bodyVarCount > 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t('sampleValues')}
                  </Label>
                  {form.body_samples.map((val, i) => {
                    const inputId = `template-body-sample-${i}`;
                    return (
                      <Input
                        key={i}
                        id={inputId}
                        aria-label={t('sampleAria', { var: `{{${i + 1}}}` })}
                        placeholder={t('samplePlaceholder', { var: `{{${i + 1}}}` })}
                        value={val}
                        onChange={(e) => {
                          const next = [...form.body_samples];
                          next[i] = e.target.value;
                          setForm({ ...form, body_samples: next });
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('footer')}</Label>
              <Input
                placeholder={t('footerPlaceholder')}
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">{t('buttons')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addButton}
                  disabled={form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal}
                  className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
                >
                  <Plus className="size-3" />
                  {t('addButton')}
                </Button>
              </div>
              {form.buttons.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('buttonsLimit', { max: TEMPLATE_LIMITS.maxButtonsTotal })}
                </p>
              ) : (
                <div className="space-y-2">
                  {form.buttons.map((btn, i) => (
                    <div
                      key={i}
                      className="space-y-2 rounded border border-border bg-muted/50 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={btn.type}
                          onValueChange={(val) => {
                            // Same null guard as the Header Select
                            // (per PR 148): @base-ui Select fires
                            // onValueChange(null) on deselect.
                            if (!val) return;
                            changeButtonType(i, val as TemplateButton['type']);
                          }}
                        >
                          <SelectTrigger className="w-40 bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem
                              value="QUICK_REPLY"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnQuickReply')}
                            </SelectItem>
                            <SelectItem
                              value="URL"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnUrl')}
                            </SelectItem>
                            <SelectItem
                              value="PHONE_NUMBER"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnPhone')}
                            </SelectItem>
                            <SelectItem
                              value="COPY_CODE"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnCopyCode')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder={t('btnLabelPlaceholder')}
                          value={btn.text}
                          maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                          onChange={(e) =>
                            updateButton(i, { text: e.target.value })
                          }
                          className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                      {btn.type === 'URL' && (
                        <div className="space-y-1 pl-1">
                          <Input
                            placeholder={t('urlPlaceholder')}
                            value={btn.url}
                            onChange={(e) =>
                              updateButton(i, { url: e.target.value })
                            }
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                          />
                          {extractVariableIndices(btn.url).length > 0 && (
                            <Input
                              placeholder={t('urlSamplePlaceholder')}
                              value={btn.example ?? ''}
                              onChange={(e) =>
                                updateButton(i, { example: e.target.value })
                              }
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          placeholder={t('phonePlaceholder')}
                          value={btn.phone_number}
                          onChange={(e) =>
                            updateButton(i, { phone_number: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'COPY_CODE' && (
                        <Input
                          placeholder={t('codePlaceholder')}
                          value={btn.example}
                          onChange={(e) =>
                            updateButton(i, { example: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
            )}

            {isCarousel && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-muted-foreground">{t('cards')}</Label>
                    <p className="text-[11px] text-muted-foreground">{t('cardsMinMax')}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCard}
                    disabled={form.cards.length >= CARD_LIMITS.maxCards}
                    className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
                  >
                    <Plus className="size-3" />
                    {t('addCard')}
                  </Button>
                </div>

                {form.cards.map((card, ci) => {
                  const cardVarCount = extractVariableIndices(card.body_text).length;
                  return (
                    <div key={ci} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {t('cardNumber', { number: ci + 1 })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeCard(ci)}
                          disabled={form.cards.length <= CARD_LIMITS.minCards}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[11px] text-muted-foreground">{t('cardHeaderFormat')}</Label>
                        <Select
                          value={card.header_format}
                          onValueChange={(val) => {
                            if (!val) return;
                            updateCard(ci, {
                              header_format: val as 'image' | 'video',
                              header_media_url: '',
                            });
                          }}
                        >
                          <SelectTrigger className="w-full bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem value="image" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                              {t('headerImage')}
                            </SelectItem>
                            <SelectItem value="video" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                              {t('headerVideo')}
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <div className="flex items-center gap-2">
                          <input
                            ref={(el) => {
                              cardFileRefs.current[ci] = el;
                            }}
                            type="file"
                            accept={HEADER_MEDIA_ACCEPT[card.header_format].accept}
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleCardMediaFile(ci, f);
                              e.target.value = '';
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingCardIndex === ci}
                            onClick={() => cardFileRefs.current[ci]?.click()}
                          >
                            {uploadingCardIndex === ci ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            {card.header_format === 'image' ? t('uploadImage') : t('uploadVideo')}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">
                            {card.header_format === 'image' ? t('uploadHint') : t('uploadHintVideo')}
                          </span>
                        </div>
                        <Input
                          placeholder={t('mediaUrlPlaceholder', { format: card.header_format })}
                          value={card.header_media_url}
                          onChange={(e) => updateCard(ci, { header_media_url: e.target.value })}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[11px] text-muted-foreground">{t('cardBody')}</Label>
                        <Textarea
                          placeholder={t('cardBodyPlaceholder')}
                          value={card.body_text}
                          onChange={(e) => updateCard(ci, { body_text: e.target.value })}
                          rows={2}
                          maxLength={CARD_LIMITS.bodyMaxLength}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none text-xs"
                        />
                        {cardVarCount > 0 && (
                          <div className="space-y-1.5">
                            {Array.from({ length: cardVarCount }).map((_, si) => (
                              <Input
                                key={si}
                                aria-label={t('sampleAria', { var: `{{${si + 1}}}` })}
                                placeholder={t('samplePlaceholder', { var: `{{${si + 1}}}` })}
                                value={card.body_samples[si] ?? ''}
                                onChange={(e) => {
                                  const next = [...card.body_samples];
                                  while (next.length <= si) next.push('');
                                  next[si] = e.target.value;
                                  updateCard(ci, { body_samples: next.slice(0, cardVarCount) });
                                }}
                                className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] text-muted-foreground">{t('cardButtons')}</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addCardButton(ci)}
                            disabled={card.buttons.length >= CARD_LIMITS.maxButtonsPerCard}
                            className="border-border bg-transparent text-muted-foreground hover:bg-muted h-6 text-[11px]"
                          >
                            <Plus className="size-3" />
                            {t('addButton')}
                          </Button>
                        </div>
                        {card.buttons.map((btn, bi) => (
                          <div key={bi} className="space-y-2 rounded border border-border bg-muted/50 p-2">
                            <div className="flex items-center gap-2">
                              <Select
                                value={btn.type}
                                onValueChange={(val) => {
                                  if (!val) return;
                                  changeCardButtonType(ci, bi, val as TemplateButton['type']);
                                }}
                              >
                                <SelectTrigger className="w-36 bg-muted border-border text-foreground h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border">
                                  <SelectItem value="QUICK_REPLY" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                                    {t('btnQuickReply')}
                                  </SelectItem>
                                  <SelectItem value="URL" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                                    {t('btnUrl')}
                                  </SelectItem>
                                  <SelectItem value="PHONE_NUMBER" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                                    {t('btnPhone')}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                placeholder={t('btnLabelPlaceholder')}
                                value={btn.text}
                                maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                                onChange={(e) => updateCardButton(ci, bi, { text: e.target.value })}
                                className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeCardButton(ci, bi)}
                                className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                            {btn.type === 'URL' && (
                              <div className="space-y-1 pl-1">
                                <Input
                                  placeholder={t('urlPlaceholder')}
                                  value={btn.url}
                                  onChange={(e) => updateCardButton(ci, bi, { url: e.target.value })}
                                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                                />
                                {extractVariableIndices(btn.url).length > 0 && (
                                  <Input
                                    placeholder={t('urlSamplePlaceholder')}
                                    value={btn.example ?? ''}
                                    onChange={(e) => updateCardButton(ci, bi, { example: e.target.value })}
                                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                                  />
                                )}
                              </div>
                            )}
                            {btn.type === 'PHONE_NUMBER' && (
                              <Input
                                placeholder={t('phonePlaceholder')}
                                value={btn.phone_number}
                                onChange={(e) => updateCardButton(ci, bi, { phone_number: e.target.value })}
                                className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-0 lg:self-start">
            <TemplatePreview
              form={{
                header_format: form.header_format,
                header_content: form.header_content,
                header_media_url: form.header_media_url,
                header_sample: form.header_sample,
                body_text: form.body_text,
                body_samples: form.body_samples,
                footer_text: form.footer_text,
                buttons: form.buttons,
                cards: form.cards,
              }}
            />
          </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || form.category === 'Authentication'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? t('saving') : t('submitting')}
                </>
              ) : editingId ? (
                t('saveResubmit')
              ) : (
                t('submitApproval')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteDialogTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? t('deleteMetaDesc', { name: templateToDelete.name })
                : t('deleteLocalDesc', { name: templateToDelete?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                t('delete')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only full-content view — opened by clicking any template
          card. Exists separately from the edit dialog so Pending/
          Draft templates (no Edit action available) can still be
          inspected in full instead of only the truncated card preview. */}
      <Dialog
        open={viewingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setViewingTemplate(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground flex items-center gap-2 flex-wrap">
              {viewingTemplate?.name}
              {viewingTemplate && (
                <>
                  <Badge className={`text-xs border ${categoryColors[viewingTemplate.category] || ''}`}>
                    {viewingTemplate.category}
                  </Badge>
                  <Badge
                    className={`text-xs border ${templateStatusConfig[viewingTemplate.status || 'DRAFT'].classes}`}
                  >
                    {templateStatusConfig[viewingTemplate.status || 'DRAFT'].label}
                  </Badge>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {viewingTemplate?.language}
            </DialogDescription>
          </DialogHeader>

          {viewingTemplate && (
            <div className="space-y-4">
              {(viewingTemplate.rejection_reason || viewingTemplate.submission_error) && (
                <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded px-2 py-1.5">
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    {viewingTemplate.rejection_reason || viewingTemplate.submission_error}
                  </span>
                </div>
              )}
              <TemplatePreview
                form={{
                  header_format: (viewingTemplate.header_type ?? 'none') as HeaderFormat,
                  header_content: viewingTemplate.header_content ?? '',
                  header_media_url: viewingTemplate.header_media_url ?? '',
                  header_sample: viewingTemplate.sample_values?.header?.[0] ?? '',
                  body_text: viewingTemplate.body_text,
                  body_samples: viewingTemplate.sample_values?.body ?? [],
                  footer_text: viewingTemplate.footer_text ?? '',
                  buttons: viewingTemplate.buttons ?? [],
                  cards: (viewingTemplate.cards ?? []).map((card) => ({
                    header_format: card.header_format,
                    header_media_url: card.header_media_url ?? '',
                    body_text: card.body_text,
                    body_samples: card.sample_values?.body ?? [],
                    buttons: card.buttons ?? [],
                  })),
                }}
              />
            </div>
          )}

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setViewingTemplate(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
