import { describe, expect, it } from 'vitest';
import {
  decodeImpersonationCookie,
  encodeImpersonationCookie,
  type ImpersonationPayload,
} from './impersonation';

const payload: ImpersonationPayload = {
  logId: '11111111-1111-1111-1111-111111111111',
  accountId: '22222222-2222-2222-2222-222222222222',
  accountName: 'Acme Inc',
  adminAccessToken: 'admin-access-token',
  adminRefreshToken: 'admin-refresh-token',
};

describe('encodeImpersonationCookie / decodeImpersonationCookie', () => {
  it('round-trips a valid payload', () => {
    const cookie = encodeImpersonationCookie(payload);
    expect(decodeImpersonationCookie(cookie)).toEqual(payload);
  });

  it('returns null for a missing cookie', () => {
    expect(decodeImpersonationCookie(null)).toBeNull();
    expect(decodeImpersonationCookie(undefined)).toBeNull();
    expect(decodeImpersonationCookie('')).toBeNull();
  });

  it('returns null for a tampered/garbage cookie', () => {
    const cookie = encodeImpersonationCookie(payload);
    expect(decodeImpersonationCookie(cookie.slice(0, -4) + 'abcd')).toBeNull();
    expect(decodeImpersonationCookie('not-even-encrypted')).toBeNull();
  });

  it('returns null when the decrypted payload is missing fields', () => {
    // Encrypt a shape that's missing required keys — decoding should
    // reject it rather than hand back a half-formed payload.
    const badPayload = encodeImpersonationCookie({
      ...payload,
      adminRefreshToken: undefined as unknown as string,
    });
    // JSON.stringify drops the `undefined` key entirely, so the
    // decrypted object really is missing `adminRefreshToken`.
    expect(decodeImpersonationCookie(badPayload)).toBeNull();
  });
});
