// ============================================================
// Resolve a notification rule's `param_mapping` (an ordered list of
// dot-paths, e.g. ["order.number", "order.tracking_url"]) against a
// webhook call's `data` object into the positional template params
// `sendMessageToConversation` expects.
//
// Pure, no I/O — the account/template lookups happen in the caller.
// ============================================================

/** Walk `path` ("order.tracking_url") into `data`. */
function getAtPath(data: unknown, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = data;
  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Stringify a resolved leaf value the way a WhatsApp template body var needs. */
function stringifyParam(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export interface ParamMappingResult {
  /** Positional params, in `param_mapping` order. */
  params: string[];
  /** The first dot-path that resolved to nothing, if any. */
  missingPath?: string;
}

/**
 * Resolve every path in `paramMapping` against `data`. A missing or
 * null/undefined leaf is reported via `missingPath` (the caller 400s
 * rather than silently sending a template with a blank variable —
 * Meta either rejects the send or delivers a visibly broken message).
 */
export function resolveParamMapping(
  paramMapping: string[],
  data: unknown
): ParamMappingResult {
  const params: string[] = [];
  for (const path of paramMapping) {
    const value = getAtPath(data, path);
    if (value === undefined || value === null) {
      return { params, missingPath: path };
    }
    params.push(stringifyParam(value));
  }
  return { params };
}
