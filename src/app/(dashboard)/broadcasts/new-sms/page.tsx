'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { CustomField, Tag } from '@/types';
import {
  useSmsBroadcast,
  type SmsAudienceConfig,
  type SmsCustomFieldOperator,
} from '@/hooks/use-sms-broadcast';
import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { useAuth } from '@/hooks/use-auth';
import { listEnabledDevicesWithCapacity, type SmsDeviceCapacity } from '@/lib/sms/device-assignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, MessageSquare, Upload, Users } from 'lucide-react';

const SMS_MAX_CHARS = 918; // 6 GSM-7 segments — a generous ceiling before per-recipient cost climbs a lot.

const OPERATOR_OPTIONS: { value: SmsCustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

export default function NewSmsBroadcastPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const { createAndSendSmsBroadcast, isProcessing, progress } = useSmsBroadcast();

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState<SmsAudienceConfig['type']>('all');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [customFieldId, setCustomFieldId] = useState('');
  const [customFieldOperator, setCustomFieldOperator] = useState<SmsCustomFieldOperator>('is');
  const [customFieldValue, setCustomFieldValue] = useState('');
  const [csvContacts, setCsvContacts] = useState<{ phone: string; name?: string }[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [deviceCapacity, setDeviceCapacity] = useState<SmsDeviceCapacity[] | null>(null);

  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  useEffect(() => {
    if (audienceType !== 'custom_field' || customFields.length > 0) return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('custom_fields').select('*').order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audienceType, customFields.length]);

  // Shown as a heads-up before sending — actual per-device enforcement
  // happens at send time (round-robin assignment + per-device cap
  // inside sendSmsToConversation), this is just so the form doesn't
  // surprise the user with a mid-send cutoff.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const devices = await listEnabledDevicesWithCapacity(supabase, accountId);
        if (!cancelled) setDeviceCapacity(devices);
      } catch {
        if (!cancelled) setDeviceCapacity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function handleCsvFile(file: File) {
    const text = await file.text();
    const { rows } = parseContactCsv(text);
    setCsvContacts(rows.map((r) => ({ phone: r.phone, name: r.name })));
    setCsvFileName(file.name);
  }

  const isValid =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    body.length <= SMS_MAX_CHARS &&
    (audienceType === 'all' ||
      (audienceType === 'tags' && tagIds.length > 0) ||
      (audienceType === 'custom_field' && !!customFieldId && customFieldValue.trim().length > 0) ||
      (audienceType === 'csv' && csvContacts.length > 0));

  async function handleSend() {
    try {
      const id = await createAndSendSmsBroadcast({
        name: name.trim(),
        body: body.trim(),
        audience: {
          type: audienceType,
          tagIds: audienceType === 'tags' ? tagIds : undefined,
          customField:
            audienceType === 'custom_field'
              ? { fieldId: customFieldId, operator: customFieldOperator, value: customFieldValue.trim() }
              : undefined,
          csvContacts: audienceType === 'csv' ? csvContacts : undefined,
        },
      });
      router.push(`/broadcasts/sms/${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SMS broadcast failed';
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.push('/broadcasts')} className="border-border">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <MessageSquare className="h-5 w-5 text-primary" />
            New SMS Broadcast
          </h1>
          <p className="text-sm text-muted-foreground">
            Plain-text bulk SMS via your connected SMS Gateway device — no template approval needed.
          </p>
        </div>
      </div>

      {deviceCapacity !== null && (() => {
        const totalRemaining = deviceCapacity.reduce((sum, d) => sum + d.remaining, 0);
        const deviceCount = deviceCapacity.length;
        return (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              deviceCount === 0 || totalRemaining === 0
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : totalRemaining <= 20
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  : 'border-border bg-muted/50 text-muted-foreground'
            }`}
          >
            {deviceCount === 0
              ? 'No enabled SMS device connected — connect one in Settings → SMS before sending.'
              : totalRemaining === 0
                ? `All ${deviceCount} connected device${deviceCount === 1 ? '' : 's'} have reached today's limit — sends will fail until it resets.`
                : `${totalRemaining.toLocaleString()} SMS of capacity left today across ${deviceCount} connected device${deviceCount === 1 ? '' : 's'}. Recipients beyond that fail per-device, not silently dropped.`}
          </div>
        );
      })()}

      {isProcessing ? (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-6 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Sending… {progress}%</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="sms-broadcast-name">Campaign name</Label>
            <Input
              id="sms-broadcast-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekend offer"
            />
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-4">
            <p className="mb-3 text-sm font-medium text-foreground">Audience</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'all' ? 'default' : 'outline'}
                onClick={() => setAudienceType('all')}
                className={audienceType === 'all' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                <Users className="h-3.5 w-3.5" />
                All contacts
              </Button>
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'tags' ? 'default' : 'outline'}
                onClick={() => setAudienceType('tags')}
                className={audienceType === 'tags' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                By tag
              </Button>
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'custom_field' ? 'default' : 'outline'}
                onClick={() => setAudienceType('custom_field')}
                className={audienceType === 'custom_field' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                By custom field
              </Button>
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'csv' ? 'default' : 'outline'}
                onClick={() => setAudienceType('csv')}
                className={audienceType === 'csv' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                <Upload className="h-3.5 w-3.5" />
                CSV upload
              </Button>
            </div>

            {audienceType === 'tags' && (
              <div className="mt-3">
                {loadingTags ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tags found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const selected = tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                            selected
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-border bg-muted text-muted-foreground hover:border-border'
                          }`}
                        >
                          <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {audienceType === 'custom_field' && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
                <select
                  value={customFieldId}
                  onChange={(e) => setCustomFieldId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">{loadingFields ? 'Loading…' : 'Select field…'}</option>
                  {customFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.field_name}
                    </option>
                  ))}
                </select>
                <select
                  value={customFieldOperator}
                  onChange={(e) => setCustomFieldOperator(e.target.value as SmsCustomFieldOperator)}
                  className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {OPERATOR_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <Input
                  value={customFieldValue}
                  onChange={(e) => setCustomFieldValue(e.target.value)}
                  placeholder="Value…"
                />
              </div>
            )}

            {audienceType === 'csv' && (
              <div className="mt-3">
                <input
                  type="file"
                  accept=".csv"
                  id="sms-csv-upload"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCsvFile(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('sms-csv-upload')?.click()}
                  className="border-border"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Choose CSV file
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {csvFileName
                    ? `${csvFileName} — ${csvContacts.length} contact${csvContacts.length === 1 ? '' : 's'} found`
                    : 'Needs a "phone" column; "name" is optional.'}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sms-broadcast-body">Message</Label>
            <Textarea
              id="sms-broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{name}}, ..."
              rows={5}
              className={body.length > SMS_MAX_CHARS ? 'border-red-500' : ''}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Use <code className="rounded bg-muted px-1">{'{{name}}'}</code> to insert the contact&apos;s name.</span>
              <span className={body.length > SMS_MAX_CHARS ? 'text-red-400' : ''}>
                {body.length} / {SMS_MAX_CHARS}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-border pt-4">
            <Button
              onClick={handleSend}
              disabled={!isValid}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <MessageSquare className="h-4 w-4" />
              Send SMS Broadcast
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
