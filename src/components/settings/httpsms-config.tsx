'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

interface HttpSmsNumber {
  id: string;
  label: string;
  phone_number: string;
  webhook_url: string;
  status: 'connected' | 'disconnected';
  enabled: boolean;
  connected_at: string | null;
}

export function HttpSmsConfig() {
  const [numbers, setNumbers] = useState<HttpSmsNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newApiKey, setNewApiKey] = useState('');

  const fetchNumbers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/httpsms/config', { method: 'GET' });
      const data = await res.json();
      setNumbers(data.numbers ?? []);
    } catch (err) {
      console.error('[httpsms-config] fetchNumbers error:', err);
      toast.error('Failed to load httpSMS numbers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNumbers();
  }, [fetchNumbers]);

  async function handleAddNumber() {
    if (!newPhoneNumber.trim() || !newApiKey.trim()) {
      toast.error('Phone number and API key are both required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/httpsms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim() || undefined,
          phone_number: newPhoneNumber.trim(),
          api_key: newApiKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to connect number: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      if (data.webhook_registered === false) {
        toast.warning(
          'Number connected, but the webhook could not be auto-registered — paste the URL below into httpsms.com → Settings → Webhooks manually to receive replies.',
        );
      } else {
        toast.success('Number connected — replies will arrive automatically.');
      }
      setNewLabel('');
      setNewPhoneNumber('');
      setNewApiKey('');
      setAddOpen(false);
      await fetchNumbers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(number: HttpSmsNumber, next: boolean) {
    setTogglingId(number.id);
    try {
      const res = await fetch(`/api/httpsms/config/${number.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      setNumbers((prev) => prev.map((n) => (n.id === number.id ? { ...n, enabled: next } : n)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(number: HttpSmsNumber) {
    if (!confirm(`Remove "${number.label}"? Conversations already on this number keep their history but can no longer send.`)) {
      return;
    }
    setDeletingId(number.id);
    try {
      const res = await fetch(`/api/httpsms/config/${number.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      setNumbers((prev) => prev.filter((n) => n.id !== number.id));
      toast.success('Number removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setDeletingId(null);
    }
  }

  function handleCopyWebhook(number: HttpSmsNumber) {
    navigator.clipboard.writeText(number.webhook_url).then(() => {
      setCopiedId(number.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="httpSMS connection"
          description="Connect a phone number via httpsms.com — an independent SMS channel, separate from the SMS Gateway integration above."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="httpSMS connection"
        description="Connect a phone number registered on httpsms.com (github.com/NdoleStudio/httpsms) — a cloud-relay SMS channel, independent from the SMS Gateway integration. The webhook for receiving replies is registered automatically when you connect a number; the URL below is shown in case you ever need to re-register it manually in your httpsms.com dashboard."
      />

      <div className="space-y-4">
        {numbers.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-8 text-center text-muted-foreground">
              No httpSMS numbers connected yet.
            </CardContent>
          </Card>
        ) : (
          numbers.map((number) => (
            <Card key={number.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {number.status === 'connected' ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <XCircle className="size-4 text-red-500" />
                    )}
                    <CardTitle className="text-foreground">{number.label}</CardTitle>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={number.enabled}
                      onCheckedChange={(v) => handleToggle(number, !!v)}
                      disabled={togglingId === number.id}
                      aria-label={`Enable ${number.label}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDelete(number)}
                      disabled={deletingId === number.id}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      {deletingId === number.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
                <CardDescription>{number.phone_number}</CardDescription>
              </CardHeader>
              <CardContent>
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  Webhook URL (auto-registered) — only needed if you ever have to re-add it manually in httpsms.com → Settings → Webhooks
                </Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={number.webhook_url} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" onClick={() => handleCopyWebhook(number)}>
                    {copiedId === number.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedId === number.id ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {addOpen ? (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">Add httpSMS Number</CardTitle>
              <CardDescription>
                From httpsms.com → Settings: copy your API key, and use the phone number you registered there.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="httpsms-new-label">Label</Label>
                <Input
                  id="httpsms-new-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Support line"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="httpsms-new-phone">Phone number</Label>
                <Input
                  id="httpsms-new-phone"
                  value={newPhoneNumber}
                  onChange={(e) => setNewPhoneNumber(e.target.value)}
                  placeholder="+15555550100"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="httpsms-new-api-key">API key</Label>
                <Input
                  id="httpsms-new-api-key"
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="From https://httpsms.com/settings"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddNumber} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? 'Connecting…' : 'Connect Number'}
                </Button>
                <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setAddOpen(true)} className="border-border">
            <Plus className="size-4" />
            Add Number
          </Button>
        )}
      </div>
    </section>
  );
}
