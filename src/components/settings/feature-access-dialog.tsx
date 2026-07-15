'use client';

// ============================================================
// Settings → Members → per-agent "Manage access" dialog.
//
// Broadcasts, Automations, and Templates are admin+ by default; an
// 'agent' only gets one when explicitly granted here. Owner/admin
// members never see this control (they already have everything).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const GATED_FEATURES = ['broadcasts', 'automations', 'templates'] as const;
type GatedFeature = (typeof GATED_FEATURES)[number];

const FEATURE_LABEL: Record<GatedFeature, string> = {
  broadcasts: 'Broadcasts',
  automations: 'Automations',
  templates: 'Templates',
};

export function FeatureAccessDialog({
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
  const [features, setFeatures] = useState<Set<GatedFeature>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/feature-grants`);
      const json = await res.json();
      if (res.ok) {
        setFeatures(new Set(json.features as GatedFeature[]));
      } else {
        toast.error(json.error || 'Failed to load feature access');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = (feature: GatedFeature, checked: boolean) => {
    setFeatures((prev) => {
      const next = new Set(prev);
      if (checked) next.add(feature);
      else next.delete(feature);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/feature-grants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: Array.from(features) }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Feature access updated for ${memberName}`);
        onOpenChange(false);
      } else {
        toast.error(json.error || 'Failed to update feature access');
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
            <ShieldCheck className="size-4 text-primary" />
            Manage access — {memberName}
          </DialogTitle>
          <DialogDescription>
            Broadcasts, Automations, and Templates are hidden from agents by default. Turn
            any of these on to give {memberName} access to that feature specifically.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {GATED_FEATURES.map((feature) => (
              <label
                key={feature}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:bg-muted"
              >
                <Checkbox
                  checked={features.has(feature)}
                  onCheckedChange={(checked) => toggle(feature, checked === true)}
                />
                <span className="text-sm font-medium text-foreground">
                  {FEATURE_LABEL[feature]}
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
