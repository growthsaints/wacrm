"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Smartphone, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionStatus = "disconnected" | "connecting" | "qr_pending" | "connected";

interface StatusResponse {
  status: ConnectionStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
}

export default function WhatsAppPersonalConnectPage() {
  const [state, setState] = useState<StatusResponse | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(() => {
    fetch("/api/business-workspace/whatsapp-personal/status")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = (await res.json()) as StatusResponse;
        setState(json);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  useEffect(() => {
    const shouldPoll = state?.status === "connecting" || state?.status === "qr_pending";
    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [state?.status, fetchStatus]);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/business-workspace/whatsapp-personal/connect", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Failed to start connection.");
        return;
      }
      fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/business-workspace/whatsapp-personal/disconnect", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to disconnect.");
        return;
      }
      toast.success("Disconnected.");
      fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (notEnabled || !state) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        WhatsApp Personal Connect isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          This links your own WhatsApp Business app (like adding a Linked
          Device) for 1:1 chat capture only — it is not Meta&apos;s official
          Cloud API and is not endorsed by WhatsApp. There is no bulk-send
          capability on this channel and there never will be; use it only
          for normal, human-paced conversations. Numbers used this way can
          be flagged or restricted by WhatsApp at their discretion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Smartphone className="size-4 text-primary" /> Personal WhatsApp Connection
            </span>
            {state.status === "connected" ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <Wifi className="size-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline">
                <WifiOff className="size-3" /> {state.status.replace("_", " ")}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "disconnected" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Not connected yet. Click Connect, then scan the QR code with
                the WhatsApp app you want to link: WhatsApp → Settings →
                Linked Devices → Link a Device.
              </p>
              <Button onClick={handleConnect} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Connect
              </Button>
            </div>
          )}

          {state.status === "connecting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Preparing connection…
            </div>
          )}

          {state.status === "qr_pending" && state.qrDataUrl && (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.qrDataUrl} alt="Scan with WhatsApp" className="size-56 rounded-lg border border-border" />
              <p className="text-xs text-muted-foreground">
                Scan this with WhatsApp → Settings → Linked Devices → Link a
                Device. This refreshes automatically if it expires.
              </p>
            </div>
          )}

          {state.status === "connected" && (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Connected{state.phoneNumber ? ` as +${state.phoneNumber}` : ""}.
              </p>
              <Button variant="destructive" onClick={handleDisconnect} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Disconnect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
