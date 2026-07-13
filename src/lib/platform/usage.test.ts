import { describe, expect, it } from 'vitest';
import { startOfMonthIso } from './usage';

describe('startOfMonthIso', () => {
  it('returns midnight UTC on the 1st of the given month', () => {
    expect(startOfMonthIso(new Date('2026-07-13T15:42:00Z'))).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });

  it('handles December correctly without rolling into next year', () => {
    expect(startOfMonthIso(new Date('2026-12-31T23:59:59Z'))).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });
});
