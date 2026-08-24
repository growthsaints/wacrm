'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_PASSWORD = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

export function SmsConfig() {
  const t = useTranslations('Settings.sms');
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  // Same re-hydration guard as WhatsAppConfig — avoid clobbering an
  // unsaved edit when the auth effect re-fires for unrelated reasons
  // (tab regains focus → token refresh).
  const loadedAccountIdRef = useRef<string | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordEdited, setPasswordEdited] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sms/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setHasConfig(true);
        setConnectionStatus('connected');
        setStatusMessage('');
        setBaseUrl(payload.base_url || '');
        setUsername(payload.username || '');
        setPassword(MASKED_PASSWORD);
        setWebhookUrl(payload.webhook_url || '');
        setEnabled(payload.enabled ?? true);
      } else if (payload.reason === 'no_config') {
        setHasConfig(false);
        setConnectionStatus('unknown');
        setStatusMessage('');
        setBaseUrl('');
        setUsername('');
        setPassword('');
        setWebhookUrl('');
        setEnabled(true);
      } else {
        // A row exists but the connection currently fails (bad
        // credentials, gateway unreachable, corrupted ciphertext).
        setHasConfig(true);
        setConnectionStatus('disconnected');
        setStatusMessage(payload.message || '');
        setBaseUrl(payload.base_url || '');
        setUsername(payload.username || '');
        setPassword(MASKED_PASSWORD);
        setWebhookUrl(payload.webhook_url || '');
        setEnabled(payload.enabled ?? true);
      }
      setPasswordEdited(false);
    } catch (err) {
      console.error('[sms-config] fetchConfig error:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig();
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!baseUrl.trim()) {
      toast.error(t('baseUrlRequired'));
      return;
    }
    if (!username.trim()) {
      toast.error(t('usernameRequired'));
      return;
    }
    if (!hasConfig && (!password.trim() || !passwordEdited)) {
      toast.error(t('passwordRequired'));
      return;
    }
    if (hasConfig && !(passwordEdited && password !== MASKED_PASSWORD && password.trim())) {
      // Existing config, password untouched — the server needs the
      // plaintext to re-verify the connection, so require re-entry
      // rather than silently reusing the stored ciphertext.
      toast.error(t('passwordRequired'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/sms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          username: username.trim(),
          password: password.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(t('toastSaveFailed', { reason: data.error || `HTTP ${res.status}` }));
        return;
      }

      toast.success(t('toastSaved'));
      setWebhookUrl(data.webhook_url || webhookUrl);
      await fetchConfig();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(t('toastSaveFailed', { reason }));
    } finally {
      setSaving(false);
    }
  }

  const handleCopyWebhook = useCallback(() => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [webhookUrl]);

  // Pause/resume the channel without touching saved credentials — flips
  // sms_config.enabled via PATCH. New sends and inbound webhook
  // processing both check this server-side, so the toggle is the real
  // gate, not just a UI affordance.
  async function handleToggleEnabled(next: boolean) {
    setTogglingEnabled(true);
    const previous = enabled;
    setEnabled(next); // optimistic
    try {
      const res = await fetch('/api/sms/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEnabled(previous);
        toast.error(t('toastSaveFailed', { reason: data.error || `HTTP ${res.status}` }));
        return;
      }
      toast.success(next ? t('enabledOn') : t('enabledOff'));
    } catch (err) {
      setEnabled(previous);
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(t('toastSaveFailed', { reason }));
    } finally {
      setTogglingEnabled(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connectionStatus === 'connected' ? t('connected') : t('notConnected')}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connectionStatus === 'connected'
              ? t('connectedDesc')
              : statusMessage || t('notConnectedDesc')}
          </AlertDescription>
        </Alert>

        {hasConfig && (
          <Alert className="bg-card border-border">
            <div className="flex items-center justify-between gap-3">
              <div>
                <AlertTitle className="text-foreground mb-0">{t('enableTitle')}</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  {t('enableDesc')}
                </AlertDescription>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => handleToggleEnabled(!!v)}
                disabled={togglingEnabled}
                aria-label={t('enableTitle')}
              />
            </div>
          </Alert>
        )}

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
            <CardDescription>{t('credentialsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sms-base-url">{t('baseUrl')}</Label>
              <Input
                id="sms-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('baseUrlPlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sms-username">{t('username')}</Label>
              <Input
                id="sms-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sms-password">{t('password')}</Label>
              <div className="relative">
                <Input
                  id="sms-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordEdited(true);
                  }}
                  onFocus={() => {
                    if (!passwordEdited && password === MASKED_PASSWORD) {
                      setPassword('');
                    }
                  }}
                  placeholder={t('passwordPlaceholder')}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {hasConfig && !passwordEdited && (
                <p className="text-xs text-muted-foreground">{t('passwordHidden')}</p>
              )}
            </div>

            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? t('saving') : t('saveBtn')}
            </Button>
          </CardContent>
        </Card>

        {webhookUrl && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
              <CardDescription>{t('webhookDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyWebhook}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? t('copied') : t('copyBtn')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
