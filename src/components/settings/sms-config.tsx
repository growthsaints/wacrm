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

interface SmsDevice {
  id: string;
  label: string;
  base_url: string;
  username: string;
  webhook_url: string;
  status: 'connected' | 'disconnected';
  enabled: boolean;
  connected_at: string | null;
  sent_today: number;
  daily_cap: number;
}

export function SmsConfig() {
  const [devices, setDevices] = useState<SmsDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sms/config', { method: 'GET' });
      const data = await res.json();
      setDevices(data.devices ?? []);
    } catch (err) {
      console.error('[sms-config] fetchDevices error:', err);
      toast.error('Failed to load SMS devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  async function handleAddDevice() {
    if (!newBaseUrl.trim() || !newUsername.trim() || !newPassword.trim()) {
      toast.error('Base URL, username, and password are all required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/sms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim() || undefined,
          base_url: newBaseUrl.trim(),
          username: newUsername.trim(),
          password: newPassword.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to connect device: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      toast.success('Device connected');
      setNewLabel('');
      setNewBaseUrl('');
      setNewUsername('');
      setNewPassword('');
      setAddOpen(false);
      await fetchDevices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(device: SmsDevice, next: boolean) {
    setTogglingId(device.id);
    try {
      const res = await fetch(`/api/sms/config/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, enabled: next } : d)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(device: SmsDevice) {
    if (!confirm(`Remove "${device.label}"? Conversations already on this device keep their history but can no longer send.`)) {
      return;
    }
    setDeletingId(device.id);
    try {
      const res = await fetch(`/api/sms/config/${device.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
      toast.success('Device removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setDeletingId(null);
    }
  }

  function handleCopyWebhook(device: SmsDevice) {
    navigator.clipboard.writeText(device.webhook_url).then(() => {
      setCopiedId(device.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="SMS connection"
          description="Connect one or more self-hosted SMS Gateway for Android devices. Text-only send/receive alongside WhatsApp in the shared inbox."
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
        title="SMS connection"
        description="Connect one or more self-hosted SMS Gateway for Android devices. Text-only send/receive alongside WhatsApp in the shared inbox. Each device has its own daily send limit — a new customer's first message is assigned to whichever connected device has the most room left today; replies keep using that same device so the customer always hears from the same number."
      />

      <div className="space-y-4">
        {devices.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-8 text-center text-muted-foreground">
              No SMS devices connected yet.
            </CardContent>
          </Card>
        ) : (
          devices.map((device) => (
            <Card key={device.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {device.status === 'connected' ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <XCircle className="size-4 text-red-500" />
                    )}
                    <CardTitle className="text-foreground">{device.label}</CardTitle>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {device.sent_today} / {device.daily_cap} today
                    </span>
                    <Switch
                      checked={device.enabled}
                      onCheckedChange={(v) => handleToggle(device, !!v)}
                      disabled={togglingId === device.id}
                      aria-label={`Enable ${device.label}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDelete(device)}
                      disabled={deletingId === device.id}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      {deletingId === device.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  {device.base_url} — {device.username}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Input readOnly value={device.webhook_url} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" onClick={() => handleCopyWebhook(device)}>
                    {copiedId === device.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedId === device.id ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {addOpen ? (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">Add SMS Device</CardTitle>
              <CardDescription>
                From the SMS Gateway Android app: enable Local, Private, or Cloud server mode and copy its
                address + Basic Auth username/password here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sms-new-label">Label</Label>
                <Input
                  id="sms-new-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Phone 1 — Sales"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-new-base-url">Base URL</Label>
                <Input
                  id="sms-new-base-url"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder="http://192.168.1.20:8080 or https://api.sms-gate.app/3rdparty/v1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-new-username">Username</Label>
                <Input id="sms-new-username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-new-password">Password</Label>
                <Input
                  id="sms-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter the gateway password"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddDevice} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? 'Connecting…' : 'Connect Device'}
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
            Add Device
          </Button>
        )}
      </div>
    </section>
  );
}
