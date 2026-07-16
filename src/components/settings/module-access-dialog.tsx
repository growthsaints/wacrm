'use client';

// ============================================================
// Settings → Members → per-admin "Manage module access" dialog.
//
// Enterprise (Campaign Intelligence) and Business Workspace gate
// admin-role members by default — only the owner has access
// automatically. Owner-only control: an admin can't grant themselves
// or a peer admin access here (see module-access API route + RLS).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, ShieldCheck } from 'lucide-react';

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

const GATED_MODULES = ['enterprise', 'business_workspace'] as const;
type GatedModule = (typeof GATED_MODULES)[number];

const MODULE_LABEL: Record<GatedModule, string> = {
  enterprise: 'Enterprise (Campaign Intelligence)',
  business_workspace: 'Business Workspace',
};

export function ModuleAccessDialog({
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
  const [modules, setModules] = useState<Set<GatedModule>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/module-access`);
      const json = await res.json();
      if (res.ok) {
        setModules(new Set(json.modules as GatedModule[]));
      } else {
        toast.error(json.error || 'Failed to load module access');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = (module: GatedModule, checked: boolean) => {
    setModules((prev) => {
      const next = new Set(prev);
      if (checked) next.add(module);
      else next.delete(module);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${userId}/module-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: Array.from(modules) }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Module access updated for ${memberName}`);
        onOpenChange(false);
      } else {
        toast.error(json.error || 'Failed to update module access');
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
            <Building2 className="size-4 text-primary" />
            Manage module access — {memberName}
          </DialogTitle>
          <DialogDescription>
            Enterprise and Business Workspace are hidden from admins by
            default — only the owner has them automatically. Turn any of
            these on to give {memberName} access to that module.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {GATED_MODULES.map((module) => (
              <label
                key={module}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:bg-muted"
              >
                <Checkbox
                  checked={modules.has(module)}
                  onCheckedChange={(checked) => toggle(module, checked === true)}
                />
                <span className="text-sm font-medium text-foreground">
                  {MODULE_LABEL[module]}
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
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
