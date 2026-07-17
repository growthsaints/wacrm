/**
 * Pure validators for message templates, run BEFORE the Meta submit
 * call so a misconfigured template fails at save time (with a specific
 * field-level error) rather than at the Meta API boundary (where the
 * error is a generic 400 + opaque rejection_reason hours later).
 *
 * Every validator throws `Error(message)` — callers catch and surface
 * to the UI. Caps follow Meta's published limits for the Cloud API
 * template surface (v21.0):
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * Per-element button validation lives here rather than as a JSONB CHECK
 * because Postgres CHECK constraints can't contain subqueries, and
 * generic CHECK violations don't give users an actionable error
 * ("button #3 has no `text`" beats "constraint violated").
 */

import type {
  MessageTemplate,
  TemplateButton,
  TemplateCard,
  TemplateSampleValues,
} from '@/types';

export const TEMPLATE_LIMITS = {
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtonsTotal: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
  maxCopyCodeButtons: 1,
  /** Meta: lowercase a-z, digits, underscore. Up to 512 chars. */
  nameRegex: /^[a-z0-9_]{1,512}$/,
} as const;

/** Meta's limits for a Carousel template's cards (distinct from the
 * whole-template limits above — a card is a smaller structure). */
export const CARD_LIMITS = {
  minCards: 2,
  maxCards: 10,
  bodyMaxLength: 160,
  maxButtonsPerCard: 2,
} as const;

export interface TemplatePayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type?: MessageTemplate['header_type'];
  header_content?: string;
  header_media_url?: string;
  header_handle?: string;
  body_text: string;
  footer_text?: string;
  buttons?: TemplateButton[];
  /** Present only for Carousel templates. See validateCards(). */
  cards?: TemplateCard[];
  sample_values?: TemplateSampleValues;
}

export function validateTemplateName(name: string): void {
  if (!name) throw new Error('Template name is required.');
  if (!TEMPLATE_LIMITS.nameRegex.test(name)) {
    throw new Error(
      'Template name must use only lowercase letters, digits, and underscores (1-512 chars).',
    );
  }
}

/**
 * Extract sorted, deduplicated {{N}} indices from a string. Returns
 * `[1, 2, 4]` for `"Hi {{1}} {{2}}, item {{4}}"`.
 */
export function extractVariableIndices(text: string): number[] {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const set = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Meta requires contiguous, 1-indexed variables. `{{1}} {{3}}` is
 * invalid — it must be `{{1}} {{2}}`.
 */
function assertContiguous(indices: number[], where: string): void {
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i + 1) {
      throw new Error(
        `${where} variables must be contiguous starting at {{1}} — found ${indices
          .map((n) => `{{${n}}}`)
          .join(', ')}.`,
      );
    }
  }
}

export function validateBody(bodyText: string): number[] {
  if (!bodyText.trim()) throw new Error('Body text is required.');
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} chars (got ${bodyText.length}).`,
    );
  }
  const indices = extractVariableIndices(bodyText);
  assertContiguous(indices, 'Body');
  return indices;
}

export function validateFooter(footerText: string | undefined): void {
  if (!footerText) return;
  if (footerText.length > TEMPLATE_LIMITS.footerMaxLength) {
    throw new Error(
      `Footer text exceeds ${TEMPLATE_LIMITS.footerMaxLength} chars (got ${footerText.length}).`,
    );
  }
  if (extractVariableIndices(footerText).length > 0) {
    throw new Error('Footer text cannot contain {{N}} variables (Meta rule).');
  }
}

export interface HeaderValidationResult {
  /** number of {{N}} placeholders in a TEXT header — 0 or 1. */
  variableCount: number;
}

export function validateHeader(
  payload: Pick<
    TemplatePayload,
    'header_type' | 'header_content' | 'header_media_url' | 'header_handle'
  >,
): HeaderValidationResult {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type) return { variableCount: 0 };

  if (header_type === 'text') {
    if (!header_content || !header_content.trim()) {
      throw new Error('Text header requires header_content.');
    }
    if (header_content.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      throw new Error(
        `Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} chars (got ${header_content.length}).`,
      );
    }
    const indices = extractVariableIndices(header_content);
    if (indices.length > 1) {
      throw new Error(
        `Text header supports at most one variable — found ${indices.length} (Meta rule).`,
      );
    }
    if (indices.length === 1 && indices[0] !== 1) {
      throw new Error('Text header variable must be {{1}} (Meta rule).');
    }
    return { variableCount: indices.length };
  }

  // image / video / document need either a public URL or a Resumable
  // Upload handle. Either one — Meta accepts both example forms.
  if (!header_media_url && !header_handle) {
    throw new Error(
      `${header_type} header requires either a public sample URL (header_media_url) or a Resumable Upload handle (header_handle).`,
    );
  }
  if (header_media_url) {
    try {
      const u = new URL(header_media_url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('header_media_url must use http(s) scheme.');
      }
    } catch {
      throw new Error('header_media_url must be a valid URL.');
    }
  }
  return { variableCount: 0 };
}

function countButtonsByType(
  buttons: TemplateButton[],
): Record<TemplateButton['type'], number> {
  const counts: Record<TemplateButton['type'], number> = {
    QUICK_REPLY: 0,
    URL: 0,
    PHONE_NUMBER: 0,
    COPY_CODE: 0,
  };
  for (const b of buttons) counts[b.type]++;
  return counts;
}

export function validateButtons(buttons: TemplateButton[] | undefined): void {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > TEMPLATE_LIMITS.maxButtonsTotal) {
    throw new Error(
      `Templates can have at most ${TEMPLATE_LIMITS.maxButtonsTotal} buttons (got ${buttons.length}).`,
    );
  }

  const counts = countButtonsByType(buttons);
  if (counts.URL > TEMPLATE_LIMITS.maxUrlButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxUrlButtons} URL buttons allowed (got ${counts.URL}).`,
    );
  }
  if (counts.PHONE_NUMBER > TEMPLATE_LIMITS.maxPhoneButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxPhoneButtons} PHONE_NUMBER button allowed (got ${counts.PHONE_NUMBER}).`,
    );
  }
  if (counts.COPY_CODE > TEMPLATE_LIMITS.maxCopyCodeButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxCopyCodeButtons} COPY_CODE button allowed (got ${counts.COPY_CODE}).`,
    );
  }

  // Meta rule: QUICK_REPLY buttons must be contiguous — they can't be
  // interleaved with CTA buttons. Easiest check: walk the array; once
  // we leave the QUICK_REPLY block, we must not see another.
  let sawNonQR = false;
  for (const b of buttons) {
    if (b.type === 'QUICK_REPLY') {
      if (sawNonQR) {
        throw new Error(
          'QUICK_REPLY buttons cannot be interleaved with URL / PHONE_NUMBER / COPY_CODE buttons — group them at the start.',
        );
      }
    } else {
      sawNonQR = true;
    }
  }

  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.text?.trim()) {
      throw new Error(`Button #${i + 1} (${b.type}) is missing text.`);
    }
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      throw new Error(
        `Button #${i + 1} text exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} chars.`,
      );
    }
    switch (b.type) {
      case 'URL': {
        if (!b.url?.trim()) {
          throw new Error(`URL button #${i + 1} is missing url.`);
        }
        try {
          new URL(b.url);
        } catch {
          throw new Error(`URL button #${i + 1} has an invalid url.`);
        }
        const urlVars = extractVariableIndices(b.url);
        if (urlVars.length > 1) {
          throw new Error(
            `URL button #${i + 1} can have at most one variable (Meta rule).`,
          );
        }
        if (urlVars.length === 1) {
          if (urlVars[0] !== 1) {
            throw new Error(
              `URL button #${i + 1} variable must be {{1}} (Meta rule).`,
            );
          }
          if (!b.example?.trim()) {
            throw new Error(
              `URL button #${i + 1} uses {{1}} — Meta requires an example value.`,
            );
          }
        }
        break;
      }
      case 'PHONE_NUMBER':
        if (!b.phone_number?.trim()) {
          throw new Error(
            `PHONE_NUMBER button #${i + 1} is missing phone_number.`,
          );
        }
        break;
      case 'COPY_CODE':
        if (!b.example?.trim()) {
          throw new Error(
            `COPY_CODE button #${i + 1} is missing example value.`,
          );
        }
        break;
    }
  }
}

/**
 * Sample values must be supplied 1:1 with the variables in the body
 * (and header, if it has one). Meta uses these for human review.
 */
export function validateSampleValues(
  payload: TemplatePayload,
  bodyVarCount: number,
  headerVarCount: number,
): void {
  const samples = payload.sample_values ?? {};
  const body = samples.body ?? [];
  const header = samples.header ?? [];

  if (body.length !== bodyVarCount) {
    throw new Error(
      `Body has ${bodyVarCount} variable(s) — supply exactly ${bodyVarCount} sample value(s) (got ${body.length}).`,
    );
  }
  if (header.length !== headerVarCount) {
    throw new Error(
      `Header has ${headerVarCount} variable(s) — supply exactly ${headerVarCount} sample value(s) (got ${header.length}).`,
    );
  }
  for (let i = 0; i < body.length; i++) {
    if (!body[i] || !body[i].trim()) {
      throw new Error(`Body sample value #${i + 1} is empty.`);
    }
  }
  for (let i = 0; i < header.length; i++) {
    if (!header[i] || !header[i].trim()) {
      throw new Error(`Header sample value #${i + 1} is empty.`);
    }
  }
}

/** `"QUICK_REPLY,URL"` etc — used to compare two cards' button shapes. */
function buttonSignature(buttons: TemplateCard['buttons'] | undefined): string {
  return (buttons ?? []).map((b) => b.type).join(',');
}

function validateCardButtons(
  buttons: TemplateCard['buttons'] | undefined,
  cardNumber: number,
): void {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > CARD_LIMITS.maxButtonsPerCard) {
    throw new Error(
      `Card #${cardNumber} can have at most ${CARD_LIMITS.maxButtonsPerCard} buttons (got ${buttons.length}).`,
    );
  }
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.text?.trim()) {
      throw new Error(`Card #${cardNumber} button #${i + 1} is missing text.`);
    }
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      throw new Error(
        `Card #${cardNumber} button #${i + 1} text exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} chars.`,
      );
    }
    if (b.type === 'URL') {
      if (!b.url?.trim()) {
        throw new Error(`Card #${cardNumber} URL button #${i + 1} is missing url.`);
      }
      try {
        new URL(b.url);
      } catch {
        throw new Error(`Card #${cardNumber} URL button #${i + 1} has an invalid url.`);
      }
      const urlVars = extractVariableIndices(b.url);
      if (urlVars.length > 1) {
        throw new Error(
          `Card #${cardNumber} URL button #${i + 1} can have at most one variable (Meta rule).`,
        );
      }
      if (urlVars.length === 1) {
        if (urlVars[0] !== 1) {
          throw new Error(
            `Card #${cardNumber} URL button #${i + 1} variable must be {{1}} (Meta rule).`,
          );
        }
        if (!b.example?.trim()) {
          throw new Error(
            `Card #${cardNumber} URL button #${i + 1} uses {{1}} — Meta requires an example value.`,
          );
        }
      }
    } else if (b.type === 'PHONE_NUMBER') {
      if (!b.phone_number?.trim()) {
        throw new Error(
          `Card #${cardNumber} PHONE_NUMBER button #${i + 1} is missing phone_number.`,
        );
      }
    }
  }
}

/**
 * Validates a Carousel template's cards. No-op when `cards` is absent
 * (a plain, non-carousel template). Meta's carousel-specific rules
 * enforced here (beyond the per-card checks already covered by the
 * whole-template validators above):
 *
 *   - The main template can't also have its own header/footer — a
 *     carousel's only top-level components are BODY + CAROUSEL.
 *   - 2-10 cards.
 *   - Every card shares the same header format (all image or all
 *     video — never mixed).
 *   - Every card has the identical button types in the identical
 *     order (Meta renders cards as a synchronized carousel; a "Buy
 *     now" button can't sit at index 0 on one card and index 1 on
 *     another).
 *   - COPY_CODE isn't a valid card-button type (TemplateCard's type
 *     already excludes it, so a mismatch here is a payload bug, not a
 *     user input to explain — no runtime check needed).
 */
export function validateCards(
  payload: Pick<TemplatePayload, 'header_type' | 'footer_text' | 'buttons' | 'cards'>,
): void {
  const { cards } = payload;
  if (!cards) return;

  if (payload.header_type) {
    throw new Error(
      'A carousel template cannot also have its own header — each card supplies its own image/video header instead.',
    );
  }
  if (payload.footer_text?.trim()) {
    throw new Error('A carousel template cannot have a footer (Meta rule).');
  }
  if (payload.buttons && payload.buttons.length > 0) {
    throw new Error(
      'A carousel template cannot have its own buttons — put buttons on each card instead.',
    );
  }
  if (cards.length < CARD_LIMITS.minCards || cards.length > CARD_LIMITS.maxCards) {
    throw new Error(
      `A carousel needs between ${CARD_LIMITS.minCards} and ${CARD_LIMITS.maxCards} cards (got ${cards.length}).`,
    );
  }

  const headerFormat = cards[0].header_format;
  const buttonSig = buttonSignature(cards[0].buttons);

  cards.forEach((card, i) => {
    const cardNumber = i + 1;

    if (card.header_format !== headerFormat) {
      throw new Error(
        `Every card must use the same header type — card #1 is ${headerFormat}, card #${cardNumber} is ${card.header_format} (Meta rule).`,
      );
    }
    if (!card.header_media_url && !card.header_handle) {
      throw new Error(
        `Card #${cardNumber} needs a ${card.header_format} — upload one or paste a public link.`,
      );
    }
    if (card.header_media_url) {
      try {
        const u = new URL(card.header_media_url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      } catch {
        throw new Error(`Card #${cardNumber}'s media link must be a valid http(s) URL.`);
      }
    }

    if (!card.body_text?.trim()) {
      throw new Error(`Card #${cardNumber} needs body text.`);
    }
    if (card.body_text.length > CARD_LIMITS.bodyMaxLength) {
      throw new Error(
        `Card #${cardNumber} body text exceeds ${CARD_LIMITS.bodyMaxLength} chars (got ${card.body_text.length}).`,
      );
    }
    const indices = extractVariableIndices(card.body_text);
    assertContiguous(indices, `Card #${cardNumber} body`);
    const sample = card.sample_values?.body ?? [];
    if (sample.length !== indices.length) {
      throw new Error(
        `Card #${cardNumber} body has ${indices.length} variable(s) — supply exactly ${indices.length} sample value(s) (got ${sample.length}).`,
      );
    }
    sample.forEach((s, si) => {
      if (!s?.trim()) {
        throw new Error(`Card #${cardNumber} body sample value #${si + 1} is empty.`);
      }
    });

    const cardButtonSig = buttonSignature(card.buttons);
    if (cardButtonSig !== buttonSig) {
      throw new Error(
        `Every card must have the same button types in the same order — card #1 is [${buttonSig || 'none'}], card #${cardNumber} is [${cardButtonSig || 'none'}] (Meta rule).`,
      );
    }
    validateCardButtons(card.buttons, cardNumber);
  });
}

/**
 * Run every validator. Throws on the first failure with a specific,
 * field-level message. Returns the variable counts so callers can
 * reuse them when building the Meta components payload.
 */
export function validateTemplatePayload(payload: TemplatePayload): {
  bodyVarCount: number;
  headerVarCount: number;
} {
  validateTemplateName(payload.name);
  if (!payload.language?.trim()) {
    throw new Error('Language is required.');
  }
  const bodyVars = validateBody(payload.body_text);
  validateFooter(payload.footer_text);
  const headerResult = validateHeader(payload);
  validateButtons(payload.buttons);
  validateSampleValues(payload, bodyVars.length, headerResult.variableCount);
  validateCards(payload);
  return {
    bodyVarCount: bodyVars.length,
    headerVarCount: headerResult.variableCount,
  };
}
