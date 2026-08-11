"use client";

// ============================================================
// Global top banner (mounted in dashboard-shell.tsx, alongside
// TrialBanner) surfacing a flagged Meta account-level webhook event —
// see use-whatsapp-account-alert.ts for what "flagged" means and why
// this doesn't assert a specific ban/restriction. Owner/admin only,
// since RLS on whatsapp_account_events requires admin+ to read it.
// ============================================================

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { useWhatsAppAccountAlert } from "@/hooks/use-whatsapp-account-alert";

export function WhatsAppAccountAlertBanner() {
  const { canEditSettings } = useAuth();
  const alert = useWhatsAppAccountAlert(canEditSettings);
  const t = useTranslations("Settings.whatsappManagement");

  if (!alert) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 bg-red-500/15 px-4 py-2 text-sm text-red-800 dark:text-red-300">
      <AlertTriangle className="size-4 shrink-0" />
      <span>
        {t("accountAlertDesc", {
          date: new Date(alert.created_at).toLocaleDateString(),
        })}
      </span>
    </div>
  );
}
