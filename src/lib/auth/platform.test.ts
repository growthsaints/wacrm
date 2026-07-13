import { describe, expect, it } from 'vitest';
import { isBootstrapEmail, parseBootstrapEmails } from './platform';

describe('parseBootstrapEmails', () => {
  it('splits, trims, and lowercases a comma-separated list', () => {
    expect(parseBootstrapEmails(' Founder@Example.com, Ops@example.com ')).toEqual([
      'founder@example.com',
      'ops@example.com',
    ]);
  });

  it('drops empty entries from stray commas', () => {
    expect(parseBootstrapEmails('a@example.com,,b@example.com,')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('returns an empty list for undefined/empty input', () => {
    expect(parseBootstrapEmails(undefined)).toEqual([]);
    expect(parseBootstrapEmails('')).toEqual([]);
  });
});

describe('isBootstrapEmail', () => {
  const list = 'founder@example.com, ops@example.com';

  it('matches case-insensitively', () => {
    expect(isBootstrapEmail('Founder@Example.com', list)).toBe(true);
  });

  it('rejects an email not on the list', () => {
    expect(isBootstrapEmail('someone-else@example.com', list)).toBe(false);
  });

  it('rejects null/undefined email', () => {
    expect(isBootstrapEmail(null, list)).toBe(false);
    expect(isBootstrapEmail(undefined, list)).toBe(false);
  });

  it('rejects everything when no list is configured', () => {
    expect(isBootstrapEmail('founder@example.com', undefined)).toBe(false);
  });
});
