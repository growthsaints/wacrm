import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  findActiveNotificationRule,
  resolveTemplateParams,
  serializeNotificationRule,
  normalizeParamMapping,
} from './rules';

function makeDb(row: Record<string, unknown> | null, errorMessage?: string) {
  const maybeSingle = vi.fn(async () => ({
    data: row,
    error: errorMessage ? { message: errorMessage } : null,
  }));
  const eq3 = vi.fn(() => ({ maybeSingle }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe('findActiveNotificationRule', () => {
  it('returns null when no rule is configured', async () => {
    const db = makeDb(null);
    const rule = await findActiveNotificationRule(db, 'acct-1', 'order.shipped');
    expect(rule).toBeNull();
  });

  it('returns null and logs on a DB error', async () => {
    const db = makeDb(null, 'boom');
    const rule = await findActiveNotificationRule(db, 'acct-1', 'order.shipped');
    expect(rule).toBeNull();
  });

  it('maps a found row into the camelCase shape, filtering non-string mapping entries', async () => {
    const db = makeDb({
      id: 'rule-1',
      event: 'order.shipped',
      template_name: 'order_shipped',
      template_language: 'en_US',
      param_mapping: ['order.number', 42, 'order.total'],
      is_active: true,
    });
    const rule = await findActiveNotificationRule(db, 'acct-1', 'order.shipped');
    expect(rule).toEqual({
      id: 'rule-1',
      event: 'order.shipped',
      templateName: 'order_shipped',
      templateLanguage: 'en_US',
      paramMapping: ['order.number', 'order.total'],
    });
  });

  it('defaults templateLanguage to "en" when the row has none', async () => {
    const db = makeDb({
      id: 'rule-1',
      event: 'order.shipped',
      template_name: 'order_shipped',
      template_language: '',
      param_mapping: [],
      is_active: true,
    });
    const rule = await findActiveNotificationRule(db, 'acct-1', 'order.shipped');
    expect(rule?.templateLanguage).toBe('en');
  });
});

describe('resolveTemplateParams', () => {
  const data = {
    order: { number: 'ORD-42', total: 99.5 },
    customer: { name: 'Jane' },
  };

  it('resolves nested dot-paths in order', () => {
    expect(
      resolveTemplateParams(['order.number', 'customer.name'], data)
    ).toEqual(['ORD-42', 'Jane']);
  });

  it('stringifies non-string values', () => {
    expect(resolveTemplateParams(['order.total'], data)).toEqual(['99.5']);
  });

  it('resolves a missing/typo\'d path to an empty string rather than throwing', () => {
    expect(resolveTemplateParams(['order.tracking_number'], data)).toEqual(['']);
    expect(resolveTemplateParams(['nope.nope.nope'], data)).toEqual(['']);
  });

  it('returns an empty array for an empty mapping', () => {
    expect(resolveTemplateParams([], data)).toEqual([]);
  });
});

describe('normalizeParamMapping', () => {
  it('defaults undefined to an empty array', () => {
    expect(normalizeParamMapping(undefined)).toEqual([]);
  });

  it('trims and passes through a valid string array', () => {
    expect(normalizeParamMapping([' order.number ', 'order.total'])).toEqual([
      'order.number',
      'order.total',
    ]);
  });

  it('rejects a non-array', () => {
    expect(normalizeParamMapping('order.number')).toBeNull();
  });

  it('rejects an array containing a non-string or blank entry', () => {
    expect(normalizeParamMapping(['order.number', 42])).toBeNull();
    expect(normalizeParamMapping(['order.number', '  '])).toBeNull();
  });
});

describe('serializeNotificationRule', () => {
  it('projects a row into the API shape', () => {
    const row = {
      id: 'rule-1',
      event: 'order.shipped',
      template_name: 'order_shipped',
      template_language: 'en',
      param_mapping: ['order.number'],
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(serializeNotificationRule(row)).toEqual({
      id: 'rule-1',
      event: 'order.shipped',
      template_name: 'order_shipped',
      template_language: 'en',
      param_mapping: ['order.number'],
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});
