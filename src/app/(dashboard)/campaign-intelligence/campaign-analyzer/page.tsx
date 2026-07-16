"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CampaignAnalysis } from "@/lib/enterprise/queries";

interface TemplateOption {
  name: string;
  language: string;
  status: string;
}

export default function CampaignAnalyzerPage() {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState("");
  const [analysis, setAnalysis] = useState<CampaignAnalysis | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("message_templates")
      .select("name, language, status")
      .eq("status", "Approved")
      .then(({ data }) => {
        setTemplates((data as TemplateOption[]) ?? []);
        setLoadingTemplates(false);
      });
  }, []);

  async function handleAnalyze() {
    if (!selected) return;
    const [name, language] = selected.split("::");
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch(
        `/api/enterprise/campaign-analyzer?template=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to analyze template.");
        return;
      }
      setAnalysis(data.analysis);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze Before Broadcasting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            {loadingTemplates ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose an approved template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button onClick={handleAnalyze} disabled={!selected || analyzing}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Analyze
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{analysis.templateName}</span>
              <Badge
                className={cn(
                  analysis.riskLevel === "high" && "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
                  analysis.riskLevel === "medium" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  analysis.riskLevel === "low" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                )}
              >
                {analysis.riskLevel} risk
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Language</p>
                <p className="text-sm font-medium text-foreground">{analysis.language}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Length</p>
                <p className="text-sm font-medium text-foreground">{analysis.bodyLength} chars</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Variables</p>
                <p className="text-sm font-medium text-foreground">{analysis.variableCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Media Header</p>
                <p className="text-sm font-medium text-foreground">{analysis.hasMediaHeader ? "Yes" : "No"}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Est. Delivery Rate</p>
                <p className="text-lg font-semibold text-foreground">{analysis.estimatedDeliveryRate}%</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Est. Read Rate</p>
                <p className="text-lg font-semibold text-foreground">{analysis.estimatedReadRate}%</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Est. Reply Rate</p>
                <p className="text-lg font-semibold text-foreground">{analysis.estimatedReplyRate}%</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Estimates are this template&apos;s (or your account&apos;s) own
              historical average — not a prediction model.
            </p>

            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">Suggestions</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {analysis.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
