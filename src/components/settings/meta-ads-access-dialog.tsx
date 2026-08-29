'use client';

// ============================================================
// Settings → Members → per-member "Manage Meta Ads access" dialog.
//
// Meta Ads is owner-only by default for EVERY role, including admin
// (unlike every other gated feature in this app, which defaults to
// admin+) — it can spend a connected client's ad budget. Owner-only
// control: only the account owner can grant it to anyone else.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Megaphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function MetaAdsAccessDialog({
  userId,
  memberName,
  open,
  onOpenChange,
}: {
  userId: string;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granted, setGranted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/meta-ads-access`);
      const json = await res.json();
      if (res.ok) {
        setGranted(Boolean(json.granted));
      } else {
        toast.error(json.error || 'Failed to load Meta Ads access');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/meta-ads-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granted }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Meta Ads access ${granted ? 'granted to' : 'revoked from'} ${memberName}`);
        onOpenChange(false);
      } else {
        toast.error(json.error || 'Failed to update Meta Ads access');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            Manage Meta Ads access — {memberName}
          </DialogTitle>
          <DialogDescription>
            Meta Ads is hidden by default for everyone but the account owner — it can spend a
            connected client&apos;s ad budget. Turn this on to give {memberName} access.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-between gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:bg-muted">
            <span className="text-sm font-medium text-foreground">Meta Ads access</span>
            <Switch checked={granted} onCheckedChange={setGranted} />
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
