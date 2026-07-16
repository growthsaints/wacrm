"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TASKS = [
  { value: "summarize", label: "Conversation Summary" },
  { value: "suggest_reply", label: "Suggested Reply" },
  { value: "translate", label: "Translate" },
  { value: "improve_grammar", label: "Improve Grammar" },
  { value: "change_tone", label: "Tone Changer" },
  { value: "qualify_lead", label: "Lead Qualification" },
  { value: "detect_intent", label: "Intent Detection" },
  { value: "sentiment", label: "Sentiment Analysis" },
];

export default function AiAssistantPage() {
  const [task, setTask] = useState("summarize");
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("English");
  const [tone, setTone] = useState("friendly");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/business-workspace/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, input: input.trim(), target, tone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to run.");
        return;
      }
      setResult(data.result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> AI Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Uses your account&apos;s own configured AI agent (Settings → AI
            Agents). Paste any text — a conversation excerpt, a draft reply —
            and pick a task below.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="mb-1.5 block">Task</Label>
              <Select value={task} onValueChange={(v) => setTask(v ?? "summarize")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASKS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {task === "translate" && (
              <div>
                <Label className="mb-1.5 block">Target Language</Label>
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Hindi" />
              </div>
            )}
            {task === "change_tone" && (
              <div>
                <Label className="mb-1.5 block">Tone</Label>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="formal" />
              </div>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block">Input</Label>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={5} placeholder="Paste text here…" />
          </div>
          <Button onClick={handleRun} disabled={loading || !input.trim()}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Run
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-foreground">{result}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
