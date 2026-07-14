/**
 * Type definitions for the Flows runtime.
 *
 * These mirror the Supabase schema added in migration 010 (`flows`,
 * `flow_nodes`, `flow_runs`, `flow_run_events`) plus the discriminated
 * unions the engine uses to typecheck node configs.
 *
 * Schema invariants enforced here that the DB CHECK constraints don't:
 *   - Each node_type maps to one config shape — adding a new node_type
 *     requires adding the matching config interface AND extending
 *     `FlowNodeConfig` so the engine's exhaustiveness checks light up.
 *   - Edges live INSIDE the config (each button row / list row carries
 *     `next_node_key`). The DB schema doesn't model this — the
 *     validator (PR #3) catches missing or orphan edges at save time.
 *
 * `next_node_key` is the stable string id stored in `flow_nodes.node_key`,
 * not a UUID, so flows can be cloned / templated without rewriting
 * references in JSONB.
 */

// ============================================================
// Node configs (discriminated union by node_type)
// ============================================================

export interface StartNodeConfig {
  /** Stable node_key of the first real node to advance to. */
  next_node_key: string;
}

export interface SendMessageNodeConfig {
  /** Plain text sent to the customer; can interpolate {{vars.X}}. */
  text: string;
  /** Auto-advance target after the message lands at Meta. */
  next_node_key: string;
}

export interface SendButtonsNodeConfig {
  text: string;
  /** Optional header / footer lines around the buttons. */
  header_text?: string;
  footer_text?: string;
  /** 1-3 buttons; Meta cap enforced in meta-api validation. */
  buttons: Array<{
    /** Stable id sent back by Meta when this button is tapped. */
    reply_id: string;
    /** Visible label (≤ 20 chars per Meta). */
    title: string;
    /** node_key the runner advances to when this button is tapped. */
    next_node_key: string;
  }>;
}

export interface SendListNodeConfig {
  text: string;
  /** Label of the tap-to-expand button on the message bubble. */
  button_label: string;
  header_text?: string;
  footer_text?: string;
  /** 1-10 rows TOTAL across sections; cap enforced in meta-api. */
  sections: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

/**
 * Sends a single image / video / document via WhatsApp, then
 * auto-advances. The media file is uploaded to the `flow-media`
 * Supabase Storage bucket by the builder; `media_url` is the public
 * URL Meta fetches at send time.
 *
 * Why one node with a `media_type` discriminator (rather than three
 * separate node types): Meta's send-side payload differs only in the
 * top-level key (`image` / `video` / `document`) and the
 * filename-on-document quirk. Modeling three node types would triple
 * the builder forms, engine cases, and add-menu entries for no
 * meaningful behavioural difference.
 */
export interface SendMediaNodeConfig {
  media_type: "image" | "video" | "document";
  /** Public URL Meta will fetch. Uploaded via the builder's file picker. */
  media_url: string;
  /** Optional caption shown under the media (Meta caps at 1024 chars). */
  caption?: string;
  /**
   * Filename shown in the recipient's chat. Documents only — Meta
   * ignores it for image/video. Defaults to the file's original name
   * at upload time; the user can edit it.
   */
  filename?: string;
  /** Auto-advance target after the send lands at Meta. */
  next_node_key: string;
}

export interface HandoffNodeConfig {
  /** Optional internal note written to flow_run_events.payload.note. */
  note?: string;
  /**
   * Optional agent user_id to assign on the conversation when this
   * node fires. Leave unset to flip the status without assignment.
   */
  assign_to?: string;
}

/**
 * Captures the customer's next free-text reply into
 * `flow_runs.vars[var_key]`, then advances.
 *
 * v1.5 ships without runtime validation (`validation` is accepted on
 * the config for forward compat but ignored by the runner); the
 * builder still surfaces the field so users can author flows that
 * v2 will start enforcing.
 */
export interface CollectInputNodeConfig {
  /** Prompt text sent to the customer before they reply. */
  prompt_text: string;
  /**
   * Key under which to store the captured text in
   * `flow_runs.vars`. Stable identifier — used by downstream
   * `condition` nodes and `handoff` notes via interpolation.
   */
  var_key: string;
  /**
   * Reserved for v2. Accepted on the config but ignored by the v1.5
   * runner — captures any non-empty text.
   */
  validation?: "any" | "email" | "phone" | "regex";
  /** Used only when `validation === 'regex'`. */
  regex?: string;
  /** Node to advance to after capture. */
  next_node_key: string;
}

export type ConditionOperator =
  | "equals"
  | "contains"
  | "present"
  | "absent";

export type ConditionSubject = "var" | "tag" | "contact_field";

/**
 * Routes the run based on a predicate over the contact's tags,
 * profile fields, or stored vars. Always auto-advances — no Meta
 * call, no customer-side input.
 */
export interface ConditionNodeConfig {
  subject: ConditionSubject;
  /**
   * For `var`: the key in flow_runs.vars.
   * For `tag`: the tag UUID (matched against contact_tags).
   * For `contact_field`: one of 'name' | 'email' | 'phone' | 'company'.
   */
  subject_key: string;
  operator: ConditionOperator;
  /** Compared against `subject` for `equals`/`contains`. Ignored for `present`/`absent`. */
  value?: string;
  /** Node to advance to when the predicate evaluates true. */
  true_next: string;
  /** Node to advance to when it evaluates false. */
  false_next: string;
}

export interface SetTagNodeConfig {
  mode: "add" | "remove";
  /** Tag UUID. The builder picks from the user's existing tags. */
  tag_id: string;
  next_node_key: string;
}

// Terminal nodes carry no config — they just stop the run.
export type EndNodeConfig = Record<string, never>;

// ============================================================
// Milestone 4 — unified-engine node types.
// ============================================================

export interface SendTemplateNodeConfig {
  template_name: string;
  language?: string;
  /** Positional {{1}}, {{2}}, … values; supports {{vars.*}} interpolation. */
  variables?: string[];
  next_node_key: string;
}

/** Sends a WhatsApp Flow (Meta's official product) as an interactive message. */
export interface SendWhatsAppFlowNodeConfig {
  whatsapp_flow_id: string;
  /** Body text shown above the "open flow" CTA. */
  text: string;
  /** Label on the CTA button (Meta caps at 20 chars). */
  cta_label: string;
  /** Optional first-screen data payload, JSON-encoded per Meta's flow_action_payload. */
  screen_data?: Record<string, unknown>;
  next_node_key: string;
}

export interface AssignAgentNodeConfig {
  mode: "specific" | "round_robin";
  agent_id?: string;
  next_node_key: string;
}

export interface CreateContactNodeConfig {
  /** Supports {{vars.*}} interpolation — typically populated from a
   *  prior collect_input or http_fetch capture. */
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  next_node_key: string;
}

export interface UpdateContactNodeConfig {
  /** Built-in column to write. Custom fields use update_custom_field instead. */
  field: "name" | "email" | "company";
  value: string;
  next_node_key: string;
}

export interface UpdateCustomFieldNodeConfig {
  custom_field_id: string;
  value: string;
  next_node_key: string;
}

/** Suspends the run for a fixed duration, then auto-resumes via the
 *  automation_jobs queue (job_type = 'flow_resume'). Mirrors the
 *  automations engine's `wait` step. */
export interface DelayNodeConfig {
  amount: number;
  unit: "minutes" | "hours" | "days";
  next_node_key: string;
}

/** Fire-and-forget outbound notification. No response is read. */
export interface WebhookNodeConfig {
  url: string;
  headers?: Record<string, string>;
  /** JSON body template; supports {{vars.*}} interpolation. Defaults
   *  to the run's vars when omitted. */
  body_template?: string;
  next_node_key: string;
}

/** Outbound HTTP call whose JSON response is captured into vars for
 *  downstream nodes (condition, send_message interpolation, etc.). */
export interface HttpFetchNodeConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body_template?: string;
  /** Dot-path (e.g. "data.order.status") extracted from the JSON
   *  response into vars[capture_as]. Omit to skip capture. */
  response_path?: string;
  capture_as?: string;
  next_node_key: string;
}

/**
 * Ordered multi-way switch — evaluates each case in order and
 * advances to the first match's target, or `default_next` if none
 * match. More general than chained `condition` nodes for the common
 * "route by status" shape (order status, tag, custom field).
 */
export interface BranchNodeConfig {
  subject: ConditionSubject;
  subject_key: string;
  cases: Array<{ value: string; next_node_key: string }>;
  default_next: string;
}

/**
 * Total union — every concrete node_type the engine understands.
 * Add new node types here and the engine's switch will flag missing
 * cases via TypeScript's exhaustiveness check.
 */
export type FlowNodeConfig =
  | { node_type: "start"; config: StartNodeConfig }
  | { node_type: "send_message"; config: SendMessageNodeConfig }
  | { node_type: "send_template"; config: SendTemplateNodeConfig }
  | { node_type: "send_buttons"; config: SendButtonsNodeConfig }
  | { node_type: "send_list"; config: SendListNodeConfig }
  | { node_type: "send_media"; config: SendMediaNodeConfig }
  | { node_type: "send_whatsapp_flow"; config: SendWhatsAppFlowNodeConfig }
  | { node_type: "collect_input"; config: CollectInputNodeConfig }
  | { node_type: "condition"; config: ConditionNodeConfig }
  | { node_type: "branch"; config: BranchNodeConfig }
  | { node_type: "set_tag"; config: SetTagNodeConfig }
  | { node_type: "assign_agent"; config: AssignAgentNodeConfig }
  | { node_type: "create_contact"; config: CreateContactNodeConfig }
  | { node_type: "update_contact"; config: UpdateContactNodeConfig }
  | { node_type: "update_custom_field"; config: UpdateCustomFieldNodeConfig }
  | { node_type: "delay"; config: DelayNodeConfig }
  | { node_type: "webhook"; config: WebhookNodeConfig }
  | { node_type: "http_fetch"; config: HttpFetchNodeConfig }
  | { node_type: "handoff"; config: HandoffNodeConfig }
  | { node_type: "end"; config: EndNodeConfig };

export type FlowNodeType = FlowNodeConfig["node_type"];

// ============================================================
// Triggers (matches `flows.trigger_type` + `trigger_config`)
// ============================================================

export interface KeywordTriggerConfig {
  /** One or more keywords. Match is case-insensitive by default. */
  keywords: string[];
  match_type?: "exact" | "contains";
  case_sensitive?: boolean;
}

// No knobs in v1 — the trigger has a single semantic. Kept as a type
// alias (not an empty interface) for forward compat without tripping
// the no-empty-object-type lint rule.
export type FirstInboundTriggerConfig = Record<string, never>;

/** Every non-message trigger the unified engine dispatches via
 *  `dispatchEventToFlows` (Milestone 4, Part 6). */
export type EventTriggerType =
  | "tag_added"
  | "tag_removed"
  | "conversation_started"
  | "conversation_closed"
  | "template_delivered"
  | "template_read"
  | "broadcast_completed"
  | "order_created"
  | "order_paid"
  | "order_delivered"
  | "order_cancelled"
  | "webhook"
  | "api";

export interface TagEventTriggerConfig {
  /** Restrict to one tag; omit to match any tag_added/tag_removed. */
  tag_id?: string;
}

export type ScheduleAudience = "all_contacts" | { tag_id: string };

export interface ScheduleTriggerConfig {
  run_at: string;
  recurring: "once" | "daily" | "weekly";
  audience: ScheduleAudience;
  /** Set by the sweep once a one-time schedule has fired, so it isn't
   *  re-picked up on the next cron pass. */
  fired_at?: string;
}

export type FlowTriggerType =
  | "keyword"
  | "first_inbound_message"
  | "manual"
  | EventTriggerType
  | "schedule";

export type FlowTriggerConfig =
  | { trigger_type: "keyword"; config: KeywordTriggerConfig }
  | { trigger_type: "first_inbound_message"; config: FirstInboundTriggerConfig }
  | { trigger_type: "manual"; config: Record<string, never> }
  | { trigger_type: "tag_added" | "tag_removed"; config: TagEventTriggerConfig }
  | { trigger_type: "schedule"; config: ScheduleTriggerConfig }
  | { trigger_type: Exclude<EventTriggerType, "tag_added" | "tag_removed">; config: Record<string, unknown> };

// ============================================================
// DB-row shapes (read by the engine via supabaseAdmin)
// ============================================================

export interface FlowRow {
  id: string;
  /** Account tenancy (NOT NULL post-017). The engine looks up active
   *  flows for inbound dispatch using this field. */
  account_id: string;
  /** Author. Used as a default sender-of-record on engine sends and
   *  preserved on flow_runs for log/audit display. */
  user_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: FlowTriggerType;
  trigger_config: KeywordTriggerConfig | FirstInboundTriggerConfig | Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  execution_count: number;
  last_executed_at: string | null;
  /** Free-text grouping for the flows list page (Part 9 categories). */
  category: string | null;
  /** Auth token for trigger_type = 'webhook'. Null otherwise. */
  webhook_token: string | null;
  schedule_config: ScheduleTriggerConfig | null;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface FlowNodeRow {
  id: string;
  flow_id: string;
  node_key: string;
  node_type: FlowNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
}

export interface FlowRunRow {
  id: string;
  flow_id: string;
  /** Tenancy. Matches flows.account_id; NOT NULL post-017. */
  account_id: string;
  /** Audit. Matches the parent flow.user_id. */
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  last_prompt_message_id: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// ============================================================
// Fallback policy (matches flows.fallback_policy JSONB)
// ============================================================

export interface FlowFallbackPolicy {
  /** What to do when the customer reply doesn't match any option. */
  on_unknown_reply: "reprompt" | "handoff" | "ignore";
  /** Max reprompts before applying `on_exhaust`. */
  max_reprompts: number;
  /** Stale-run sweep cutoff. */
  on_timeout_hours: number;
  /** What to do once max_reprompts has been hit. */
  on_exhaust: "handoff" | "end";
}

export const DEFAULT_FALLBACK_POLICY: FlowFallbackPolicy = {
  on_unknown_reply: "reprompt",
  max_reprompts: 2,
  on_timeout_hours: 24,
  on_exhaust: "handoff",
};

// ============================================================
// Engine input — what `dispatchInboundToFlows` accepts
// ============================================================

/**
 * Normalised view of an inbound message that the runner needs. The
 * webhook lifts this out of the raw Meta payload before invoking the
 * runner; keeps the runner free of any WhatsApp-API specifics.
 */
export type ParsedInbound =
  | {
      kind: "text";
      /** The user's typed message body. */
      text: string;
      /** Meta's `messages[0].id` — used for idempotency. */
      meta_message_id: string;
    }
  | {
      kind: "interactive_reply";
      /** The reply_id of the tapped button or list row. */
      reply_id: string;
      /** The visible title of the tapped option (for logging). */
      reply_title: string;
      meta_message_id: string;
    };

export interface DispatchInboundInput {
  /** Account tenancy key. Drives the lookup of active flows and the
   *  idempotency check for previously-seen inbound message_ids. */
  accountId: string;
  /** Sender-of-record for the bot's outbound prompts on engine
   *  sends. Set by the webhook to the WhatsApp config owner. */
  userId: string;
  contactId: string;
  conversationId: string;
  message: ParsedInbound;
}

/**
 * Input for `dispatchEventToFlows` — the unified entry point every
 * non-message trigger (tag changes, conversation lifecycle, template
 * delivery, order events, inbound webhook/API calls) funnels through.
 * Unlike `dispatchInboundToFlows`, there's no Meta message to key
 * idempotency off — callers that need de-dupe pass their own
 * `idempotencyKey` (e.g. the Meta status webhook's message id).
 */
export interface DispatchEventInput {
  accountId: string;
  contactId: string;
  triggerType: EventTriggerType;
  /** Extra fields the trigger's config match needs (e.g. tag_id for
   *  tag_added/tag_removed). */
  context?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface DispatchInboundResult {
  /**
   * True iff the runner handled the message — it either advanced an
   * existing run or started a new one matching a flow trigger.
   * Webhook uses this to decide whether to also fire automations.
   */
  consumed: boolean;
  /** For diagnostics / logging — null when not consumed. */
  flow_run_id?: string;
  /** For diagnostics. */
  outcome?:
    | "advanced"
    | "started"
    | "completed"
    | "handed_off"
    | "fallback_fired"
    | "duplicate_inbound_ignored"
    | "no_match";
}

// ============================================================
// Helpers — exhaustiveness assertions
// ============================================================

/**
 * Throws a typed compile-time error if the switch over a discriminated
 * union forgets a case. Used in the engine's node-type switch.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled node type: ${JSON.stringify(x)}`);
}
