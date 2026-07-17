'use client';

// ============================================================
// CreateMemberDialog
//
// The direct alternative to InviteMemberDialog: instead of generating
// a link the teammate uses to sign up themselves, the admin enters
// the teammate's name/phone/email and sets a password themselves. The
// account is created and assigned in one step — the teammate can log
// in immediately with the credentials the admin shares with them.
//
// Two-step modal, same shape as the invite dialog:
//   1. Form   — name + phone + email + password + role → POST creates
//              the login and adds it to this account.
//   2. Result — the credentials, so the admin can copy/share them.
//              We never store the plaintext password ourselves beyond
//              this response, so — like the invite link — this is the
//              only place it's ever shown again.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, Loader2, MessageCircle, RefreshCw, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';

type MemberRole = 'admin' | 'agent' | 'viewer';

interface CreateMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  member roster. */
  onCreated: () => void;
}

const MAX_NAME_LEN = 120;

function generatePassword(): string {
  // 12 chars from a mixed alphabet, avoiding visually-ambiguous
  // characters (0/O, 1/l/I) since this is read aloud/copied by hand
  // as often as pasted.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

interface CreatedMember {
  name: string;
  phone: string | null;
  email: string;
  password: string;
  role: MemberRole;
  accountName: string;
}

export function CreateMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateMemberDialogProps) {
  const t = useTranslations('Settings.createMember');
  const tRoles = useTranslations('Settings.roles');
  const { account } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<MemberRole>('agent');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedMember | null>(null);

  function reset() {
    setName('');
    setPhone('');
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setRole('agent');
    setResult(null);
    setSubmitting(false);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > MAX_NAME_LEN) {
      toast.error(t('nameRequired'));
      return;
    }
    if (!email.trim().includes('@')) {
      toast.error(t('emailInvalid'));
      return;
    }
    if (password.length < 6) {
      toast.error(t('passwordTooShort'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          phone: phone.trim() || undefined,
          email: email.trim(),
          password,
          role,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Failed to create member');
        return;
      }

      setResult({
        name: trimmedName,
        phone: phone.trim() || null,
        email: email.trim(),
        password,
        role,
        accountName: account?.name ?? 'our wacrm account',
      });
      onCreated();
    } catch (err) {
      console.error('[CreateMemberDialog] create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error(t('clipboardBlocked'));
    }
  }

  function whatsappShareUrl(): string {
    if (!result) return '#';
    const message = t('whatsappMessage', {
      accountName: result.accountName,
      email: result.email,
      password: result.password,
    });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                {t('memberCreated')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t.rich('memberCreatedDesc', {
                  role: tRoles(result.role),
                  bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-muted-foreground">{t('emailLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={result.email}
                    className="bg-muted border-border text-foreground font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    onClick={() => copyToClipboard(result.email, t('emailCopied'))}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground">{t('passwordLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={result.password}
                    className="bg-muted border-border text-foreground font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    onClick={() => copyToClipboard(result.password, t('passwordCopied'))}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">{t('saveNow')}</strong>{' '}
                {t('saveNowHint')}
              </div>

              <a
                href={whatsappShareUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'w-full border-border text-muted-foreground hover:bg-muted',
                })}
              >
                <MessageCircle className="size-4" />
                {t('sendViaWhatsApp')}
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('dialogTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('dialogDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('nameLabel')}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_NAME_LEN}
                  placeholder={t('namePlaceholder')}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('phoneLabel')} <span className="text-xs text-muted-foreground">{t('optional')}</span>
                </Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('emailLabel')}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('passwordLabel')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('passwordPlaceholder')}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPassword(generatePassword());
                      setShowPassword(true);
                    }}
                    className="border-border text-muted-foreground hover:bg-muted shrink-0"
                  >
                    <RefreshCw className="size-4" />
                    {t('generate')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('roleLabel')}</Label>
                <Select value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                    <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                    <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
                </p>
              </div>
            </div>

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
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('createMember')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
