"use client";

import { useEffect, useState } from "react";
import type { BusinessWorkspaceFeature } from "@/lib/business-workspace/features";

interface BusinessWorkspaceFeaturesState {
  loading: boolean;
  enabled: boolean;
  features: Partial<Record<BusinessWorkspaceFeature, boolean>>;
}

/**
 * The calling user's own account's Business Workspace entitlement —
 * powers the sidebar's conditional "Business Workspace" section and
 * gates each sub-page. `enabled: false` covers "no license", "license
 * expired", and "role doesn't qualify" alike — see
 * /api/business-workspace/features for the actual authorization
 * boundary.
 */
export function useBusinessWorkspaceFeatures(): BusinessWorkspaceFeaturesState {
  const [state, setState] = useState<BusinessWorkspaceFeaturesState>({
    loading: true,
    enabled: false,
    features: {},
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/business-workspace/features")
      .then((res) => res.json())
      .then((data: { enabled: boolean; features: Partial<Record<BusinessWorkspaceFeature, boolean>> }) => {
        if (!cancelled) {
          setState({ loading: false, enabled: Boolean(data.enabled), features: data.features ?? {} });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, enabled: false, features: {} });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
