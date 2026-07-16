"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CONDITIONS = [
  { value: "quality_rating_drops", label: "Quality rating drops to Yellow or Red" },
  { value: "failure_rate_above", label: "Broadcast failure rate goes above X%" },
  { value: "messaging_tier_downgraded", label: "Messaging tier is downgraded" },
  { value: "disconnected", label: "WhatsApp number disconnects" },
];

interface Rule {
  id: string;
  name: string;
  condition_type: string;
  condition_value: number | null;
  enabled: boolean;
  last_triggered_at: string | null;
}

export default function AutomationRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [name, setName] = useState("");
  const [conditionType, setConditionType] = useState("quality_rating_drops");
  const [conditionValue, setConditionValue] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/enterprise/automation-rules")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setRules(json.rules ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Give the rule a name.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/enterprise/automation-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          conditionType,
          conditionValue: conditionValue ? Number(conditionValue) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to create rule.");
        return;
      }
      toast.success("Rule created.");
      setName("");
      setConditionValue("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function toggleRule(rule: Rule) {
    const res = await fetch(`/api/enterprise/automation-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (res.ok) load();
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/enterprise/automation-rules/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Automation Rules isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Health/risk-triggered rules — distinct from the generic Automations
        feature, which triggers on messages, tags, and contacts. Each rule
        gets marked as triggered when its condition is met; there&apos;s no
        broadcast pause/resume capability to hook a more dramatic action
        into yet.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Rule</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alert me on quality drop" />
          </div>
          <div>
            <Label className="mb-1.5 block">Condition</Label>
            <Select value={conditionType} onValueChange={(v) => setConditionType(v ?? "quality_rating_drops")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {conditionType === "failure_rate_above" && (
            <div>
              <Label className="mb-1.5 block">Threshold (%)</Label>
              <Input
                type="number"
                value={conditionValue}
                onChange={(e) => setConditionValue(e.target.value)}
                placeholder="10"
              />
            </div>
          )}
          <div className="sm:col-span-4">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Rule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CONDITIONS.find((c) => c.value === rule.condition_type)?.label}
                      {rule.condition_value !== null ? ` (${rule.condition_value}%)` : ""}
                      {rule.last_triggered_at &&
                        ` · Last triggered ${new Date(rule.last_triggered_at).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule)} />
                    <Button variant="ghost" size="icon-sm" onClick={() => deleteRule(rule.id)} aria-label="Delete rule">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
