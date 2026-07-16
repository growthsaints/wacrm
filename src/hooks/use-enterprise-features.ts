"use client";

import { useEffect, useState } from "react";
import type { EnterpriseFeature } from "@/lib/enterprise/features";

interface EnterpriseFeaturesState {
  loading: boolean;
  enabled: boolean;
  features: Partial<Record<EnterpriseFeature, boolean>>;
}

/**
 * The calling user's own account's Enterprise module entitlement —
 * powers the sidebar's conditional "Enterprise" section and gates each
 * Campaign Intelligence sub-page. `enabled: false` covers "no license",
 * "license expired", and "role doesn't qualify" alike — see
 * /api/enterprise/features for the actual authorization boundary.
 */
export function useEnterpriseFeatures(): EnterpriseFeaturesState {
  const [state, setState] = useState<EnterpriseFeaturesState>({
    loading: true,
    enabled: false,
    features: {},
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/enterprise/features")
      .then((res) => res.json())
      .then((data: { enabled: boolean; features: Partial<Record<EnterpriseFeature, boolean>> }) => {
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
