'use client';

// ============================================================
// Settings → Order & Payment Alerts — dashboard UI for
// `notification_rules` (migration 066), backed by the internal
// /api/notification-rules routes (session-authenticated equivalents
// of the public /api/v1/notification-rules API).
//
// Lets an admin configure "when X order/payment/shipping event
// happens, send WhatsApp template Y" without needing an API key or
// curl — pick the event, pick an approved template, then map each
// {{n}} in the template's body to a dot-path into the event payload's
// `data` object (e.g. "order.number" reads data.order.number). The
// generic ecommerce/payment/shipping receivers (docs/public-api.md)
// look this mapping up the moment a real event arrives.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { ECOMMERCE_EVENTS, PAYMENT_EVENTS, SHIPPING_EVENTS } from '@/lib/notifications/events';
import type { MessageTemplate } from '@/types';

interface NotificationRuleRow {
  id: string;
  event: string;
  template_name: string;
  template_language: string;
  param_mapping: string[];
  is_active: boolean;
}

// Only payment.* events have a truly fixed data shape — see
// lib/payments/razorpay.ts's normalizer. order.*/shipment.* events are
// whatever the caller's own backend posts, so these are just common
// examples to nudge the input's placeholder/autocomplete, not an
// enforced schema.
const PAYMENT_PATHS = ['payment.id', 'payment.amount', 'payment.currency', 'payment.email', 'payment.contact', 'payment.order_id'];
const DEFAULT_PATHS = [
  'order.number',
  'order.total',
  'customer.name',
  'customer.phone',
  'product.name',
  'product.url',
  'shipment.tracking_number',
];

function suggestedPaths(event: string): string[] {
  return event.startsWith('payment.') ? PAYMENT_PATHS : DEFAULT_PATHS;
}

function eventLabel(event: string): string {
  return event.replace('.', ' → ').replace(/_/g, ' ');
}

interface DraftState {
  id?: string;
  event: string;
  templateName: string;
  templateLanguage: string;
  paramMapping: string[];
}

function emptyDraft(): DraftState {
  return { event: '', templateName: '', templateLanguage: 'en', paramMapping: [] };
}

export function NotificationRulesManager() {
  const [rules, setRules] = useState<NotificationRuleRow[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, supabase] = [
        await fetch('/api/notification-rules', { cache: 'no-store' }),
        createClient(),
      ];
      const rulesData = await rulesRes.json().catch(() => ({}));
      if (rulesRes.ok) setRules((rulesData.rules as NotificationRuleRow[]) ?? []);

      // Only APPROVED templates can actually be sent via Meta.
      const { data: tpl } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });
      setTemplates((tpl as MessageTemplate[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.name === draft?.templateName) ?? null,
    [templates, draft?.templateName],
  );

  const placeholders = useMemo(() => {
    if (!selectedTemplate) return [];
    const matches = selectedTemplate.body_text.match(/\{\{(\d+)\}\}/g);
    return matches ? [...new Set(matches)].sort() : [];
  }, [selectedTemplate]);

  // Keep paramMapping the same length as the template's placeholder
  // count whenever the selected template changes.
  useEffect(() => {
    setDraft((d) => {
      if (!d || d.paramMapping.length === placeholders.length) return d;
      return { ...d, paramMapping: placeholders.map((_, i) => d.paramMapping[i] ?? '') };
    });
  }, [placeholders]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (rule: NotificationRuleRow) =>
    setDraft({
      id: rule.id,
      event: rule.event,
      templateName: rule.template_name,
      templateLanguage: rule.template_language,
      paramMapping: rule.param_mapping,
    });

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.event) {
      toast.error('Pick which event this rule fires on.');
      return;
    }
    if (!draft.templateName.trim()) {
      toast.error('Pick a template.');
      return;
    }
    if (draft.paramMapping.some((p) => !p.trim())) {
      toast.error('Every {{n}} in the template needs a mapping.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/notification-rules/${draft.id}` : '/api/notification-rules',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: draft.event,
            template_name: draft.templateName,
            template_language: draft.templateLanguage,
            param_mapping: draft.paramMapping,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the rule.");
        return;
      }
      toast.success(draft.id ? 'Rule updated.' : 'Rule created.');
      setDraft(null);
      await load();
    } catch {
      toast.error("Couldn't save the rule.");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const remove = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          'Delete this notification rule? Future events of this type will no longer send a WhatsApp message.',
        )
      )
        return;
      const res = await fetch(`/api/notification-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error("Couldn't delete the rule.");
        return;
      }
      await load();
    },
    [load],
  );

  const toggleActive = useCallback(async (rule: NotificationRuleRow, next: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: next } : r)));
    const res = await fetch(`/api/notification-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !next } : r)));
      toast.error("Couldn't update the rule.");
    }
  }, []);

  const usedEvents = useMemo(() => new Set(rules.map((r) => r.event)), [rules]);

  function eventOptions(events: readonly string[]) {
    return events.map((e) => {
      const taken = usedEvents.has(e) && e !== draft?.event;
      return (
        <SelectItem key={e} value={e} disabled={taken}>
          {eventLabel(e)}
          {taken ? ' (already configured)' : ''}
        </SelectItem>
      );
    });
  }

  return (
    <div>
      <SettingsPanelHead
        title="Order & Payment Alerts"
        description="Send a WhatsApp template automatically when an order, payment, or shipment event happens. Configure the mapping once here, then point your order/payment/shipping system at the matching webhook in docs/public-api.md."
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New rule
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No rules yet. Add one to send a WhatsApp template automatically when an order, payment,
          or shipment event happens.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {eventLabel(rule.event)}
                  </span>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {rule.template_name}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {rule.param_mapping.length > 0 ? rule.param_mapping.join(', ') : 'No variables'}
                </p>
              </div>
              <Switch checked={rule.is_active} onCheckedChange={(v) => toggleActive(rule, v)} />
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(rule)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(rule.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit rule' : 'New rule'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Event</label>
                <Select
                  value={draft.event || undefined}
                  onValueChange={(val) => setDraft({ ...draft, event: val ?? '' })}
                  disabled={!!draft.id}
                >
                  <SelectTrigger className="w-full bg-muted text-foreground">
                    <SelectValue placeholder="Select an event…" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectGroup>
                      <SelectLabel>Orders</SelectLabel>
                      {eventOptions(ECOMMERCE_EVENTS)}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Payments</SelectLabel>
                      {eventOptions(PAYMENT_EVENTS)}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Shipping</SelectLabel>
                      {eventOptions(SHIPPING_EVENTS)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {draft.id && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    The event can&apos;t be changed after a rule is created — delete and re-create
                    it instead.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Template</label>
                <Select
                  value={draft.templateName || undefined}
                  onValueChange={(val) => {
                    const name = val ?? '';
                    const tpl = templates.find((t) => t.name === name);
                    setDraft((d) =>
                      d ? { ...d, templateName: name, templateLanguage: tpl?.language ?? 'en' } : d,
                    );
                  }}
                >
                  <SelectTrigger className="w-full bg-muted text-foreground">
                    <SelectValue
                      placeholder={
                        templates.length === 0 ? 'No approved templates yet' : 'Select a template…'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {placeholders.length > 0 && (
                <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
                  <p className="text-xs font-medium text-foreground">
                    Map each variable to a field from the event data
                  </p>
                  {placeholders.map((ph, i) => {
                    const suggestions = suggestedPaths(draft.event);
                    return (
                      <div key={ph}>
                        <label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
                            {ph}
                          </span>
                        </label>
                        <Input
                          value={draft.paramMapping[i] ?? ''}
                          onChange={(e) => {
                            const next = [...draft.paramMapping];
                            next[i] = e.target.value;
                            setDraft({ ...draft, paramMapping: next });
                          }}
                          placeholder={`e.g. ${suggestions[i] ?? suggestions[0]}`}
                          className="bg-muted font-mono text-sm text-foreground"
                          list={`notification-rule-suggestions-${i}`}
                        />
                        <datalist id={`notification-rule-suggestions-${i}`}>
                          {suggestions.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-muted-foreground">
                    Dot-path into the <code className="font-mono">data</code> object your order
                    system posts to the webhook — e.g.{' '}
                    <code className="font-mono">order.number</code> reads{' '}
                    <code className="font-mono">data.order.number</code>.
                  </p>
                </div>
              )}

              {selectedTemplate && placeholders.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This template has no variables — nothing to map.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
