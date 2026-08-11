'use client';

/**
 * Browse + create from Meta's Template Library.
 *
 * Meta documents a live browse/search API for this catalog, but it
 * returns an empty result set on real WABAs even for content
 * confirmed to exist via WhatsApp Manager's own UI (verified against
 * production). So the "browse" step here reads from a small,
 * hand-verified local catalog (see template-library-catalog.ts)
 * instead of calling Meta live — the CREATE step still hits Meta's
 * real, documented, working endpoint.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { validateTemplateName } from '@/lib/whatsapp/template-validators';
import {
  TEMPLATE_LIBRARY_CATALOG,
  type TemplateLibraryCatalogEntry,
} from '@/lib/whatsapp/template-library-catalog';
import type { MessageTemplate } from '@/types';

function humanize(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const CATEGORY_COUNTS = TEMPLATE_LIBRARY_CATALOG.reduce<Record<string, number>>((acc, e) => {
  acc[e.category] = (acc[e.category] ?? 0) + 1;
  return acc;
}, {});
const TOPICS = Array.from(new Set(TEMPLATE_LIBRARY_CATALOG.map((e) => e.topic))).sort();
const USECASES = Array.from(new Set(TEMPLATE_LIBRARY_CATALOG.map((e) => e.usecase))).sort();
const INDUSTRIES = Array.from(
  new Set(TEMPLATE_LIBRARY_CATALOG.flatMap((e) => e.industries)),
).sort();
const CATEGORIES = ['UTILITY', 'AUTHENTICATION', 'MARKETING'] as const;

/** Editable state for a single button input Meta needs to fill in the library template. */
interface ButtonInputForm {
  type: 'URL' | 'PHONE_NUMBER' | 'OTP';
  baseUrl?: string;
  urlSuffixExample?: string;
  phoneNumber?: string;
  otpType?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';
  zeroTapTermsAccepted?: boolean;
}

function buildButtonInputForms(entry: TemplateLibraryCatalogEntry): ButtonInputForm[] {
  return (entry.buttons ?? [])
    .filter((b) => b.type === 'URL' || b.type === 'PHONE_NUMBER' || b.type === 'OTP')
    .map((b) => ({
      type: b.type as 'URL' | 'PHONE_NUMBER' | 'OTP',
      baseUrl: b.type === 'URL' ? b.url ?? '' : undefined,
      phoneNumber: b.type === 'PHONE_NUMBER' ? b.phoneNumber ?? '' : undefined,
      otpType: b.type === 'OTP' ? 'COPY_CODE' : undefined,
    }));
}

interface TemplateLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (template: MessageTemplate) => void;
}

export function TemplateLibraryDialog({ open, onOpenChange, onCreated }: TemplateLibraryDialogProps) {
  const t = useTranslations('Settings.templates.library');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [topic, setTopic] = useState('');
  const [usecase, setUsecase] = useState('');
  const [industry, setIndustry] = useState('');

  const [selected, setSelected] = useState<TemplateLibraryCatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<string>('UTILITY');
  const [buttonInputs, setButtonInputs] = useState<ButtonInputForm[]>([]);
  const [creating, setCreating] = useState(false);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TEMPLATE_LIBRARY_CATALOG.filter((e) => {
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (topic && e.topic !== topic) return false;
      if (usecase && e.usecase !== usecase) return false;
      if (industry && !e.industries.includes(industry)) return false;
      if (q) {
        const haystack = `${e.name} ${e.header ?? ''} ${e.body} ${e.footer ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [search, categoryFilter, topic, usecase, industry]);

  function reset() {
    setSearch('');
    setCategoryFilter('');
    setTopic('');
    setUsecase('');
    setIndustry('');
    setSelected(null);
    setName('');
    setLanguage('en_US');
    setCategory('UTILITY');
    setButtonInputs([]);
  }

  function selectEntry(entry: TemplateLibraryCatalogEntry) {
    setSelected(entry);
    setName('');
    setLanguage(entry.language);
    setCategory(entry.category);
    setButtonInputs(buildButtonInputForms(entry));
  }

  function updateButtonInput(index: number, patch: Partial<ButtonInputForm>) {
    setButtonInputs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function handleCreate() {
    if (!selected) return;
    try {
      validateTemplateName(name.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('toastInvalidName'));
      return;
    }
    if (!language.trim()) {
      toast.error(t('toastLanguageRequired'));
      return;
    }
    for (const b of buttonInputs) {
      if (b.type === 'URL' && !b.baseUrl?.trim()) {
        toast.error(t('toastUrlRequired'));
        return;
      }
      if (b.type === 'PHONE_NUMBER' && !b.phoneNumber?.trim()) {
        toast.error(t('toastPhoneRequired'));
        return;
      }
    }

    setCreating(true);
    try {
      const library_template_button_inputs = buttonInputs.length
        ? buttonInputs.map((b) => {
            if (b.type === 'URL') {
              return {
                type: 'URL',
                url: {
                  base_url: b.baseUrl!.trim(),
                  ...(b.urlSuffixExample?.trim()
                    ? { url_suffix_example: b.urlSuffixExample.trim() }
                    : {}),
                },
              };
            }
            if (b.type === 'PHONE_NUMBER') {
              return { type: 'PHONE_NUMBER', phone_number: b.phoneNumber!.trim() };
            }
            return {
              type: 'OTP',
              otp_type: b.otpType || 'COPY_CODE',
              ...(b.otpType === 'ZERO_TAP' ? { zero_tap_terms_accepted: !!b.zeroTapTermsAccepted } : {}),
            };
          })
        : undefined;

      const res = await fetch('/api/whatsapp/templates/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category,
          language: language.trim(),
          library_template_name: selected.name,
          library_template_button_inputs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Create failed (HTTP ${res.status})`);
      toast.success(t('toastCreateSuccess'));
      if (data.template) onCreated(data.template as MessageTemplate);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastCreateFailed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        className={`bg-popover border-border max-h-[90vh] overflow-y-auto ${
          selected ? 'sm:max-w-2xl lg:max-w-3xl' : 'sm:max-w-3xl xl:max-w-5xl'
        }`}
      >
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {selected ? t('configureTitle') : t('browseTitleDialog')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected ? t('configureDesc') : t('browseDesc')}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={categoryFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter('')}
                className={categoryFilter === '' ? '' : 'border-border bg-transparent text-muted-foreground hover:bg-muted'}
              >
                {t('allCategories')} ({TEMPLATE_LIBRARY_CATALOG.length})
              </Button>
              <Button
                type="button"
                variant={categoryFilter === 'UTILITY' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter('UTILITY')}
                className={categoryFilter === 'UTILITY' ? '' : 'border-border bg-transparent text-muted-foreground hover:bg-muted'}
              >
                Utility ({CATEGORY_COUNTS.UTILITY ?? 0})
              </Button>
              <Button
                type="button"
                variant={categoryFilter === 'AUTHENTICATION' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter('AUTHENTICATION')}
                className={categoryFilter === 'AUTHENTICATION' ? '' : 'border-border bg-transparent text-muted-foreground hover:bg-muted'}
              >
                Authentication ({CATEGORY_COUNTS.AUTHENTICATION ?? 0})
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground sm:col-span-2 lg:col-span-4"
              />
              <Select value={topic || '__all'} onValueChange={(v) => setTopic(!v || v === '__all' ? '' : v)}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder={t('allTopics')} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="__all" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                    {t('allTopics')}
                  </SelectItem>
                  {TOPICS.map((v) => (
                    <SelectItem key={v} value={v} className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                      {humanize(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={usecase || '__all'} onValueChange={(v) => setUsecase(!v || v === '__all' ? '' : v)}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder={t('allUsecases')} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-72">
                  <SelectItem value="__all" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                    {t('allUsecases')}
                  </SelectItem>
                  {USECASES.map((v) => (
                    <SelectItem key={v} value={v} className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                      {humanize(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={industry || '__all'} onValueChange={(v) => setIndustry(!v || v === '__all' ? '' : v)}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder={t('allIndustries')} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="__all" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                    {t('allIndustries')}
                  </SelectItem>
                  {INDUSTRIES.map((v) => (
                    <SelectItem key={v} value={v} className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                      {humanize(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Search className="size-3.5 shrink-0" />
                {t('resultsCount', { count: results.length, total: TEMPLATE_LIBRARY_CATALOG.length })}
              </div>
            </div>

            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('noResults')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                {results.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => selectEntry(entry)}
                    className="w-full text-left rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/60 transition-colors flex flex-col"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <Badge className="text-[10px]">{entry.category}</Badge>
                      <Badge className="text-[10px]" variant="outline">{humanize(entry.topic)}</Badge>
                      <span className="text-[10px] text-muted-foreground uppercase">{entry.language}</span>
                    </div>
                    <p className="text-xs font-medium text-foreground">
                      {entry.header || humanize(entry.name)}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line flex-1">{entry.body}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-1.5 truncate">{entry.name}</p>
                  </button>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
              {t('catalogDisclaimer', { count: TEMPLATE_LIBRARY_CATALOG.length })}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground -ml-2 w-fit"
            >
              <ArrowLeft className="size-3.5" />
              {t('back')}
            </Button>

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              {selected.header && (
                <p className="text-sm font-semibold text-foreground">{selected.header}</p>
              )}
              <p className="text-sm text-foreground whitespace-pre-wrap">{selected.body}</p>
              {selected.footer && (
                <p className="text-xs text-muted-foreground italic">{selected.footer}</p>
              )}
              {selected.buttons && selected.buttons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selected.buttons.map((b, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {b.text}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground font-mono pt-1">{selected.name}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('nameLabel')}</Label>
                <Input
                  placeholder={t('namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('categoryLabel')}</Label>
                <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="text-muted-foreground">{t('languageLabel')}</Label>
                <Input
                  placeholder="en_US"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {buttonInputs.length > 0 && (
              <div className="space-y-3">
                <Label className="text-muted-foreground">{t('requiredInputs')}</Label>
                {buttonInputs.map((b, i) => (
                  <div key={i} className="space-y-2 rounded border border-border bg-muted/50 p-2">
                    {b.type === 'URL' && (
                      <>
                        <Input
                          placeholder={t('urlBaseLabel')}
                          value={b.baseUrl || ''}
                          onChange={(e) => updateButtonInput(i, { baseUrl: e.target.value })}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <Input
                          placeholder={t('urlSuffixLabel')}
                          value={b.urlSuffixExample || ''}
                          onChange={(e) => updateButtonInput(i, { urlSuffixExample: e.target.value })}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      </>
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <Input
                        placeholder={t('phoneLabel')}
                        value={b.phoneNumber || ''}
                        onChange={(e) => updateButtonInput(i, { phoneNumber: e.target.value })}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                      />
                    )}
                    {b.type === 'OTP' && (
                      <div className="space-y-2">
                        <Select
                          value={b.otpType || 'COPY_CODE'}
                          onValueChange={(v) => v && updateButtonInput(i, { otpType: v as ButtonInputForm['otpType'] })}
                        >
                          <SelectTrigger className="w-full bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem value="COPY_CODE" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                              {t('otpCopyCode')}
                            </SelectItem>
                            <SelectItem value="ONE_TAP" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                              {t('otpOneTap')}
                            </SelectItem>
                            <SelectItem value="ZERO_TAP" className="text-popover-foreground focus:bg-muted focus:text-popover-foreground">
                              {t('otpZeroTap')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {b.otpType === 'ZERO_TAP' && (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Checkbox
                              checked={!!b.zeroTapTermsAccepted}
                              onCheckedChange={(v) => updateButtonInput(i, { zeroTapTermsAccepted: !!v })}
                            />
                            {t('zeroTapLabel')}
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selected && (
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('createButton')
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
