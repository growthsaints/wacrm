import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationEvent,
  normalizeTemplateName,
  normalizeTemplateLanguage,
  normalizeParamMapping,
  serializeNotificationRule,
} from './notification-rules';

describe('normalizeNotificationEvent', () => {
  it('accepts a known event', () => {
    expect(normalizeNotificationEvent('order.shipped')).toBe('order.shipped');
  });
  it('rejects an unknown event', () => {
    expect(normalizeNotificationEvent('order.teleported')).toBeNull();
  });
});

describe('normalizeTemplateName', () => {
  it('trims and accepts a non-empty string', () => {
    expect(normalizeTemplateName('  order_shipped  ')).toBe('order_shipped');
  });
  it('rejects empty/whitespace/non-string', () => {
    expect(normalizeTemplateName('')).toBeNull();
    expect(normalizeTemplateName('   ')).toBeNull();
    expect(normalizeTemplateName(42)).toBeNull();
  });
});

describe('normalizeTemplateLanguage', () => {
  it('defaults to en_US when omitted', () => {
    expect(normalizeTemplateLanguage(undefined)).toBe('en_US');
    expect(normalizeTemplateLanguage(null)).toBe('en_US');
  });
  it('passes through a provided language', () => {
    expect(normalizeTemplateLanguage('en')).toBe('en');
  });
  it('rejects an empty string', () => {
    expect(normalizeTemplateLanguage('')).toBeNull();
  });
});

describe('normalizeParamMapping', () => {
  it('defaults to [] when omitted', () => {
    expect(normalizeParamMapping(undefined)).toEqual([]);
  });
  it('accepts an array of non-empty strings, trimmed', () => {
    expect(
      normalizeParamMapping([' order.number ', 'order.tracking_url'])
    ).toEqual(['order.number', 'order.tracking_url']);
  });
  it('rejects a non-array', () => {
    expect(normalizeParamMapping('order.number')).toBeNull();
  });
  it('rejects an array containing an empty string', () => {
    expect(normalizeParamMapping(['order.number', ''])).toBeNull();
  });
});

describe('serializeNotificationRule', () => {
  it('defaults param_mapping to [] when the row has none', () => {
    const row = serializeNotificationRule({
      id: '1',
      event: 'order.shipped',
      template_name: 'order_shipped',
      template_language: 'en_US',
      param_mapping: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(row.param_mapping).toEqual([]);
  });
});
