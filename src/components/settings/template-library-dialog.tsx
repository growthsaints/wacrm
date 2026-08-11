'use client';

/**
 * Browse + create from Meta's Template Library — pre-approved
 * Utility/Authentication content that skips manual App Review and
 * comes back APPROVED immediately.
 *
 * Two-step flow inside one dialog:
 *   1. Browse — filter Meta's catalog (search/topic/usecase/industry/
 *      language) and pick an entry.
 *   2. Configure — give it a local name (Meta requires a name distinct
 *      from the library entry's own name), confirm language/category,
 *      and fill in any button inputs the entry requires (a URL button
 *      needs a base_url, a phone button needs a number, etc).
 *
 * Meta's field set for the browse endpoint isn't documented as
 * rigidly as the regular templates endpoint, so item content is read
 * defensively (several fallback shapes) and a raw-JSON toggle is
 * offered so a user isn't blocked by a field we didn't anticipate.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
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
import type { MessageTemplate } from '@/types';

const TOPICS = ['ACCOUNT_UPDATE', 'CUSTOMER_FEEDBACK', 'ORDER_MANAGEMENT', 'PAYMENTS'] as const;
const USECASES = [
  'ACCOUNT_CREATION_CONFIRMATION',
  'AUTO_PAY_REMINDER',
  'DELIVERY_CONFIRMATION',
  'DELIVERY_FAILED',
  'DELIVERY_UPDATE',
  'FEEDBACK_SURVEY',
  'FRAUD_ALERT',
  'LOW_BALANCE_WARNING',
  'ORDER_ACTION_NEEDED',
  'ORDER_CONFIRMATION',
  'ORDER_DELAY',
  'ORDER_OR_TRANSACTION_CANCEL',
  'ORDER_PICK_UP',
  'PAYMENT_ACTION_REQUIRED',
  'PAYMENT_CONFIRMATION',
  'PAYMENT_DUE_REMINDER',
  'PAYMENT_OVERDUE',
  'PAYMENT_REJECT_FAIL',
  'PAYMENT_SCHEDULED',
  'RECEIPT_ATTACHMENT',
  'RETURN_CONFIRMATION',
  'STATEMENT_AVAILABLE',
  'TRANSACTION_ALERT',
] as const;
const INDUSTRIES = ['E_COMMERCE', 'FINANCIAL_SERVICES'] as const;
const CATEGORIES = ['UTILITY', 'AUTHENTICATION', 'MARKETING'] as const;

/** Loosely-typed catalog entry — see file header re: undocumented shape. */
interface LibraryItem {
  name: string;
  language?: string;
  category?: string;
  topic?: string;
  usecase?: string;
  industry?: string;
  [key: string]: unknown;
}

interface LibraryButtonDescriptor {
  type: string;
  text?: string;
}

function humanize(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function findComponentText(item: LibraryItem, type: string): string | undefined {
  const components = Array.isArray(item.components) ? (item.components as Record<string, unknown>[]) : [];
  const comp = components.find((c) => c?.type === type);
  return typeof comp?.text === 'string' ? comp.text : undefined;
}

function getBodyPreview(item: LibraryItem): string | undefined {
  return (
    findComponentText(item, 'BODY') ||
    (typeof item.body_text === 'string' ? item.body_text : undefined) ||
    (typeof item.body === 'string' ? item.body : undefined)
  );
}

function getHeaderPreview(item: LibraryItem): string | undefined {
  return (
    findComponentText(item, 'HEADER') ||
    (typeof item.header_text === 'string' ? item.header_text : undefined) ||
    (typeof item.header === 'string' ? item.header : undefined)
  );
}

function getFooterPreview(item: LibraryItem): string | undefined {
  return (
    findComponentText(item, 'FOOTER') ||
    (typeof item.footer_text === 'string' ? item.footer_text : undefined) ||
    (typeof item.footer === 'string' ? item.footer : undefined)
  );
}

function getButtonDescriptors(item: LibraryItem): LibraryButtonDescriptor[] {
  if (Array.isArray(item.buttons)) {
    return (item.buttons as Record<string, unknown>[])
      .filter((b) => typeof b?.type === 'string')
      .map((b) => ({ type: b.type as string, text: typeof b.text === 'string' ? b.text : undefined }));
  }
  const components = Array.isArray(item.components) ? (item.components as Record<string, unknown>[]) : [];
  const buttonsComp = components.find((c) => c?.type === 'BUTTONS');
  const raw = Array.isArray(buttonsComp?.buttons) ? (buttonsComp!.buttons as Record<string, unknown>[]) : [];
  return raw
    .filter((b) => typeof b?.type === 'string')
    .map((b) => ({ type: b.type as string, text: typeof b.text === 'string' ? b.text : undefined }));
}

/** Editable state for a single button that needs input to create the template. */
interface ButtonInputForm {
  type: string;
  baseUrl?: string;
  urlSuffixExample?: string;
  phoneNumber?: string;
  otpType?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';
  zeroTapTermsAccepted?: boolean;
}

function buildButtonInputForms(descriptors: LibraryButtonDescriptor[]): ButtonInputForm[] {
  return descriptors
    .filter((d) => d.type === 'URL' || d.type === 'PHONE_NUMBER' || d.type === 'OTP')
    .map((d) => ({
      type: d.type,
      otpType: d.type === 'OTP' ? 'COPY_CODE' : undefined,
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
  const [topic, setTopic] = useState<string>('');
  const [usecase, setUsecase] = useState<string>('');
  const [industry, setIndustry] = useState<string>('');
  const [browsing, setBrowsing] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<string>('UTILITY');
  const [buttonInputs, setButtonInputs] = useState<ButtonInputForm[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset everything on close so re-opening starts fresh.
      setSelected(null);
      setItems([]);
      setSearched(false);
      setSearch('');
      setTopic('');
      setUsecase('');
      setIndustry('');
      setShowRaw(false);
    }
  }, [open]);

  async function runBrowse() {
    // The browse call is really the account's own `message_templates`
    // edge with library-specific filters layered on — calling it with
    // none of them set just returns the account's already-created
    // templates, not Meta's library catalog. Require at least one.
    if (!search.trim() && !topic && !usecase && !industry) {
      toast.error(t('toastFilterRequired'));
      return;
    }
    setBrowsing(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (topic) params.set('topic', topic);
      if (usecase) params.set('usecase', usecase);
      if (industry) params.set('industry', industry);
      const res = await fetch(`/api/whatsapp/templates/library?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Browse failed (HTTP ${res.status})`);
      setItems(Array.isArray(data.items) ? data.items : []);
      setSearched(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastBrowseFailed'));
    } finally {
      setBrowsing(false);
    }
  }

  function selectItem(item: LibraryItem) {
    setSelected(item);
    setName('');
    setLanguage(item.language || 'en_US');
    const cat = (item.category || 'UTILITY').toUpperCase();
    setCategory(CATEGORIES.includes(cat as typeof CATEGORIES[number]) ? cat : 'UTILITY');
    setButtonInputs(buildButtonInputForms(getButtonDescriptors(item)));
    setShowRaw(false);
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
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastCreateFailed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {selected ? t('configureTitle') : t('browseTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected ? t('configureDesc') : t('browseDesc')}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runBrowse();
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground sm:col-span-2"
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
              <Button
                type="button"
                variant="outline"
                onClick={() => void runBrowse()}
                disabled={browsing}
                className="border-border"
              >
                {browsing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {t('search')}
              </Button>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {browsing ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {searched ? t('noResults') : t('searchPrompt')}
                </p>
              ) : (
                items.map((item, i) => {
                  const body = getBodyPreview(item);
                  return (
                    <button
                      key={`${item.name}-${i}`}
                      type="button"
                      onClick={() => selectItem(item)}
                      className="w-full text-left rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-foreground text-sm">{humanize(item.name)}</span>
                        {item.category && <Badge className="text-[10px]">{item.category}</Badge>}
                        {item.topic && <Badge className="text-[10px]" variant="outline">{humanize(item.topic)}</Badge>}
                        {item.usecase && <Badge className="text-[10px]" variant="outline">{humanize(item.usecase)}</Badge>}
                        {item.language && (
                          <span className="text-[10px] text-muted-foreground uppercase">{item.language}</span>
                        )}
                      </div>
                      {body && <p className="text-xs text-muted-foreground line-clamp-2">{body}</p>}
                    </button>
                  );
                })
              )}
            </div>
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
              {getHeaderPreview(selected) && (
                <p className="text-sm font-semibold text-foreground">{getHeaderPreview(selected)}</p>
              )}
              {getBodyPreview(selected) && (
                <p className="text-sm text-foreground whitespace-pre-wrap">{getBodyPreview(selected)}</p>
              )}
              {getFooterPreview(selected) && (
                <p className="text-xs text-muted-foreground italic">{getFooterPreview(selected)}</p>
              )}
              {getButtonDescriptors(selected).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {getButtonDescriptors(selected).map((b, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {b.text || b.type}
                    </Badge>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground pt-1"
              >
                {showRaw ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {t('rawDetails')}
              </button>
              {showRaw && (
                <pre className="text-[10px] text-muted-foreground bg-background/60 rounded p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              )}
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
