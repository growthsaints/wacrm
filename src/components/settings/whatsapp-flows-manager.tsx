'use client';

// ============================================================
// Settings → WhatsApp Flows (Milestone 4, Part 3)
//
// Create / Publish / Preview / Version list for the official Meta
// WhatsApp Flows product. Screen authoring itself happens as raw
// Flow JSON (Meta's own documented schema) — this panel manages the
// Flow resource lifecycle, not a custom drag-and-drop screen
// designer, which would duplicate Meta's own Business Manager tooling.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';

interface WhatsAppFlowRow {
  id: string;
  name: string;
  meta_flow_id: string | null;
  categories: string[];
  status: 'draft' | 'published' | 'deprecated';
  current_version: number;
  preview_url: string | null;
  created_at: string;
}

const DEFAULT_FLOW_JSON = JSON.stringify(
  {
    version: '5.0',
    screens: [
      {
        id: 'WELCOME',
        title: 'Welcome',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            { type: 'TextHeading', text: 'Hello!' },
            {
              type: 'Footer',
              label: 'Continue',
              'on-click-action': { name: 'complete', payload: {} },
            },
          ],
        },
      },
    ],
  },
  null,
  2,
);

export function WhatsAppFlowsManager() {
  const [flows, setFlows] = useState<WhatsAppFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('CUSTOMER_SUPPORT');
  const [flowJson, setFlowJson] = useState(DEFAULT_FLOW_JSON);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp-flows', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setFlows(json.flows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(flowJson);
    } catch {
      toast.error('Flow JSON is not valid JSON');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, categories: [category], flow_json: parsed }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to create Flow');
        return;
      }
      toast.success('Flow created');
      setCreateOpen(false);
      setName('');
      setFlowJson(DEFAULT_FLOW_JSON);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp-flows/${id}/publish`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to publish');
        return;
      }
      toast.success('Flow published');
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function handlePreview(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp-flows/${id}/preview`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to fetch preview');
        return;
      }
      if (json.preview_url) window.open(json.preview_url, '_blank', 'noopener');
      else toast.error('No preview URL returned by Meta');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this Flow? This only removes it from Growth Saints CRM.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp-flows/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || 'Failed to delete');
        return;
      }
      setFlows((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <SettingsPanelHead
        title="WhatsApp Flows"
        description="Official Meta WhatsApp Flows — multi-screen forms customers fill out inside WhatsApp. Send them from the flow builder's 'Send WhatsApp Flow' node, or attach one to a template."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Flow
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Workflow className="size-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No WhatsApp Flows yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {flows.map((flow) => (
              <div key={flow.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{flow.name}</span>
                    <Badge
                      className={
                        flow.status === 'published'
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-muted text-muted-foreground'
                      }
                    >
                      {flow.status}
                    </Badge>
                    {flow.current_version > 0 && (
                      <span className="text-xs text-muted-foreground">v{flow.current_version}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {flow.categories.join(', ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePreview(flow.id)}
                    disabled={busyId === flow.id}
                  >
                    <Eye className="size-3.5" />
                    Preview
                  </Button>
                  {flow.status === 'draft' && (
                    <Button size="sm" onClick={() => handlePublish(flow.id)} disabled={busyId === flow.id}>
                      <Rocket className="size-3.5" />
                      Publish
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(flow.id)}
                    disabled={busyId === flow.id}
                    className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">New WhatsApp Flow</DialogTitle>
            <DialogDescription>
              Creates a draft Flow on Meta. Edit the JSON below or paste one exported from Meta&rsquo;s Flow Builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                {['SIGN_UP', 'SIGN_IN', 'APPOINTMENT_BOOKING', 'LEAD_GENERATION', 'CONTACT_US', 'CUSTOMER_SUPPORT', 'SURVEY', 'OTHER'].map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Flow JSON</Label>
              <Textarea
                value={flowJson}
                onChange={(e) => setFlowJson(e.target.value)}
                rows={10}
                className="bg-muted font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
