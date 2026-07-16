"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { TagManager } from "@/components/settings/tag-manager";

export default function BusinessWorkspaceLabelsPage() {
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/business-workspace/labels")
      .then((res) => setNotEnabled(res.status === 403))
      .finally(() => setLoading(false));
  }, []);

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
        Labels isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The same colour-coded tags used across Contacts and Customer Hub —
        create labels like Hot Lead, VIP, or Support here once and they show
        up everywhere.
      </p>
      <TagManager />
    </div>
  );
}
