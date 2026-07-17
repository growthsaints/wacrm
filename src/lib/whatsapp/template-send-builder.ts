/**
 * Build the Meta `components` array used by POST /{phone_number_id}/messages
 * when sending an APPROVED template.
 *
 * Distinct from `template-components.ts` — that module builds the
 * `components` for TEMPLATE CREATION (where you describe headers,
 * footers, buttons, examples). This module builds the per-send
 * `components` (where you fill in variable values and supply the
 * actual media link or button URL suffix for THIS specific delivery).
 *
 * Auto-fills as much as possible from the template row so callers
 * only need to supply values for the variable-bearing fields:
 *
 *   - Static IMAGE/VIDEO/DOCUMENT headers ride along automatically
 *     using the template's `header_media_url` (or `header_handle`).
 *     Meta requires the media component on every send even though
 *     the URL hasn't changed since approval.
 *   - TEXT headers with `{{1}}` need `headerText` from the caller.
 *   - Body variables come in as `body: string[]`, indexed by {{N}}.
 *   - URL buttons with `{{1}}` need `buttonUrlParams[i]` keyed by
 *     button index. URL buttons without variables, plus QUICK_REPLY
 *     and PHONE_NUMBER buttons, don't need send-time parameters.
 *   - COPY_CODE buttons need the actual code to display. We fall
 *     back to the template's `example` value if the caller doesn't
 *     override — that matches the most common use case (a static
 *     promo code) without forcing UI work.
 *
 * Validation throws here (not at the Meta API boundary) so a missing
 * sample surfaces as "Header text variable {{1}} requires a value",
 * not a 400 from Meta that doesn't say which field broke.
 */

import type { MessageTemplate, TemplateButton, TemplateCard } from '@/types';
import { extractVariableIndices } from './template-validators';

export interface CardSendParams {
  /** Values for this card's body {{1}}, {{2}}, … — independent of the main body's. */
  body?: string[];
  /** Override this card's static media URL for this send. */
  headerMediaUrl?: string;
  /** Alternative: send the card's media by Meta media id. */
  headerMediaId?: string;
  /** Per-button overrides keyed by the button's index within THIS card. */
  buttonParams?: Record<number, string>;
}

export interface SendTimeParams {
  /** Values for body {{1}}, {{2}}, … indexed by variable position. */
  body?: string[];
  /** Value for TEXT-header {{1}}, when the header has a variable. */
  headerText?: string;
  /** Override the template's static media URL for this send. */
  headerMediaUrl?: string;
  /** Alternative: send the media by Meta media id (from prior upload). */
  headerMediaId?: string;
  /**
   * Per-button overrides keyed by the button's index in the
   * template's `buttons` array. Used for URL buttons with a {{1}}
   * suffix and for COPY_CODE buttons whose example you want to
   * override at send time.
   */
  buttonParams?: Record<number, string>;
  /**
   * Per-card overrides for a Carousel template, indexed by the card's
   * position in `template.cards`. Only meaningful when the template
   * has cards — ignored otherwise.
   */
  cards?: CardSendParams[];
}

export type MetaSendComponent =
  | { type: 'header'; parameters: MetaSendParameter[] }
  | { type: 'body'; parameters: MetaSendParameter[] }
  | {
      type: 'button';
      sub_type: 'url' | 'quick_reply' | 'copy_code';
      index: string;
      parameters: MetaSendParameter[];
    }
  | {
      type: 'carousel';
      cards: { card_index: number; components: MetaSendComponent[] }[];
    };

type MetaSendParameter =
  | { type: 'text'; text: string }
  | { type: 'image'; image: { link?: string; id?: string } }
  | { type: 'video'; video: { link?: string; id?: string } }
  | { type: 'document'; document: { link?: string; id?: string } }
  | { type: 'coupon_code'; coupon_code: string }
  | { type: 'payload'; payload: string };

function buildHeaderComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const headerType = template.header_type;
  if (!headerType) return null;

  if (headerType === 'text') {
    // TEXT header with {{1}} → need a value. Static text headers
    // (no variables) just ride along inside the template itself; no
    // header component required on send.
    const varCount = extractVariableIndices(template.header_content ?? '').length;
    if (varCount === 0) return null;
    const value = params.headerText;
    if (!value || !value.trim()) {
      throw new Error(
        'Header text variable {{1}} requires a value — pass headerText.',
      );
    }
    return {
      type: 'header',
      parameters: [{ type: 'text', text: value }],
    };
  }

  // image / video / document — Meta requires the media component on
  // every send. Prefer the caller's explicit override; fall back to the
  // template's stored public URL.
  //
  // NOTE: `template.header_handle` is intentionally NOT used here. It's a
  // Resumable-Upload handle that's only valid as the *creation-time*
  // sample (`example.header_handle`); it is NOT a reusable send-time
  // media id, and passing it as `{ id }` makes Meta reject the send. Only
  // an explicit `headerMediaId` (a real /media upload id) is honored.
  const link = params.headerMediaUrl ?? template.header_media_url;
  const id = params.headerMediaId;
  if (!link && !id) {
    throw new Error(
      `${headerType} header requires a media link or id at send time — set header_media_url on the template or pass headerMediaUrl/headerMediaId.`,
    );
  }
  const mediaPayload: { link?: string; id?: string } = id ? { id } : { link };
  return {
    type: 'header',
    parameters: [
      headerType === 'image'
        ? { type: 'image', image: mediaPayload }
        : headerType === 'video'
          ? { type: 'video', video: mediaPayload }
          : { type: 'document', document: mediaPayload },
    ],
  };
}

function buildBodyComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const varCount = extractVariableIndices(template.body_text).length;
  const body = params.body ?? [];
  if (varCount === 0 && body.length === 0) return null;
  if (body.length < varCount) {
    throw new Error(
      `Body has ${varCount} variable(s) but only ${body.length} value(s) were supplied.`,
    );
  }
  // Trim to the variable count — extra values are dropped silently so
  // a legacy caller that passes too many doesn't error out.
  const values = body.slice(0, varCount);
  return {
    type: 'body',
    parameters: values.map((text) => ({ type: 'text', text: String(text) })),
  };
}

function buttonNeedsSendParam(
  button: TemplateButton,
  override: string | undefined,
): boolean {
  switch (button.type) {
    case 'URL':
      return extractVariableIndices(button.url).length > 0;
    case 'COPY_CODE':
      // We always emit a button param for COPY_CODE so the customer
      // gets a real code (either the caller's override or the
      // template's example as a default).
      return true;
    case 'QUICK_REPLY':
    case 'PHONE_NUMBER':
      return override !== undefined;
  }
}

function buildButtonComponent(
  button: TemplateButton,
  index: number,
  override: string | undefined,
): MetaSendComponent | null {
  if (!buttonNeedsSendParam(button, override)) return null;

  switch (button.type) {
    case 'URL': {
      // Each URL button is its own component with sub_type=url and
      // the button's index in the template's buttons array.
      if (!override || !override.trim()) {
        throw new Error(
          `URL button #${index + 1} uses {{1}} — requires a buttonParams[${index}] value.`,
        );
      }
      return {
        type: 'button',
        sub_type: 'url',
        index: String(index),
        parameters: [{ type: 'text', text: override }],
      };
    }
    case 'COPY_CODE': {
      const code = override?.trim() || button.example;
      return {
        type: 'button',
        sub_type: 'copy_code',
        index: String(index),
        parameters: [{ type: 'coupon_code', coupon_code: code }],
      };
    }
    case 'QUICK_REPLY': {
      // Only included when the caller explicitly overrides the
      // payload (rare — usually QR buttons use their default text).
      return {
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: override! }],
      };
    }
    case 'PHONE_NUMBER':
      // PHONE_NUMBER buttons never accept send-time params per Meta —
      // return null even if an override snuck through.
      return null;
  }
}

function buildCardHeaderComponent(
  card: TemplateCard,
  params: CardSendParams,
  cardNumber: number,
): MetaSendComponent {
  // Unlike the whole-template header, a card header is always media
  // (image/video) — Meta requires it on every send just like a regular
  // media header, so there's no "static, no component needed" case.
  const link = params.headerMediaUrl ?? card.header_media_url;
  const id = params.headerMediaId;
  if (!link && !id) {
    throw new Error(
      `Card #${cardNumber} needs a media link or id at send time — set header_media_url on the card or pass cards[${cardNumber - 1}].headerMediaUrl/headerMediaId.`,
    );
  }
  const mediaPayload: { link?: string; id?: string } = id ? { id } : { link };
  return {
    type: 'header',
    parameters: [
      card.header_format === 'image'
        ? { type: 'image', image: mediaPayload }
        : { type: 'video', video: mediaPayload },
    ],
  };
}

function buildCardBodyComponent(
  card: TemplateCard,
  params: CardSendParams,
  cardNumber: number,
): MetaSendComponent | null {
  const varCount = extractVariableIndices(card.body_text).length;
  const body = params.body ?? [];
  if (varCount === 0 && body.length === 0) return null;
  if (body.length < varCount) {
    throw new Error(
      `Card #${cardNumber} body has ${varCount} variable(s) but only ${body.length} value(s) were supplied.`,
    );
  }
  const values = body.slice(0, varCount);
  return {
    type: 'body',
    parameters: values.map((text) => ({ type: 'text', text: String(text) })),
  };
}

function buildCarouselComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  if (!template.cards?.length) return null;
  const cardParams = params.cards ?? [];

  return {
    type: 'carousel',
    cards: template.cards.map((card, i) => {
      const cardNumber = i + 1;
      const cp = cardParams[i] ?? {};
      const components: MetaSendComponent[] = [
        buildCardHeaderComponent(card, cp, cardNumber),
      ];
      const body = buildCardBodyComponent(card, cp, cardNumber);
      if (body) components.push(body);
      card.buttons?.forEach((btn, bi) => {
        const override = cp.buttonParams?.[bi];
        const component = buildButtonComponent(btn, bi, override);
        if (component) components.push(component);
      });
      return { card_index: i, components };
    }),
  };
}

/**
 * Build the full `components` array for the send-message payload.
 * Returns an empty array when the template is fully static (no
 * variables, no media header), which is a valid Meta request.
 */
export function buildSendComponents(
  template: MessageTemplate,
  params: SendTimeParams = {},
): MetaSendComponent[] {
  const out: MetaSendComponent[] = [];
  const header = buildHeaderComponent(template, params);
  if (header) out.push(header);
  const body = buildBodyComponent(template, params);
  if (body) out.push(body);
  if (template.buttons?.length) {
    template.buttons.forEach((btn, i) => {
      const override = params.buttonParams?.[i];
      const component = buildButtonComponent(btn, i, override);
      if (component) out.push(component);
    });
  }
  // Mutually exclusive with the top-level buttons above — a carousel
  // template never has its own buttons (validateCards() enforces this
  // at creation time), so in practice at most one of the two is ever
  // non-empty.
  const carousel = buildCarouselComponent(template, params);
  if (carousel) out.push(carousel);
  return out;
}
