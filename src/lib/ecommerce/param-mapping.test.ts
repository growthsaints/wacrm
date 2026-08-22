import { describe, expect, it } from 'vitest';
import { resolveParamMapping } from './param-mapping';

describe('resolveParamMapping', () => {
  it('resolves dot-paths in order', () => {
    const data = { order: { number: 'ORD-1042', tracking_url: 'https://t' } };
    expect(
      resolveParamMapping(['order.number', 'order.tracking_url'], data)
    ).toEqual({
      params: ['ORD-1042', 'https://t'],
    });
  });

  it('returns an empty params array for an empty mapping', () => {
    expect(resolveParamMapping([], { anything: true })).toEqual({ params: [] });
  });

  it('stringifies numbers and booleans', () => {
    const data = { amount: 499.5, paid: true };
    expect(resolveParamMapping(['amount', 'paid'], data)).toEqual({
      params: ['499.5', 'true'],
    });
  });

  it('reports the first missing path and stops there', () => {
    const data = { order: { number: 'ORD-1' } };
    const result = resolveParamMapping(
      ['order.number', 'order.tracking_url', 'order.eta'],
      data
    );
    expect(result.missingPath).toBe('order.tracking_url');
    expect(result.params).toEqual(['ORD-1']);
  });

  it('treats null the same as missing', () => {
    const result = resolveParamMapping(['order.tracking_url'], {
      order: { tracking_url: null },
    });
    expect(result.missingPath).toBe('order.tracking_url');
  });

  it('treats a non-object intermediate as missing rather than throwing', () => {
    const result = resolveParamMapping(['order.number'], {
      order: 'not-an-object',
    });
    expect(result.missingPath).toBe('order.number');
  });

  it('handles a top-level path with no dots', () => {
    expect(resolveParamMapping(['name'], { name: 'Rahul' })).toEqual({
      params: ['Rahul'],
    });
  });
});
