import { describe, expect, it } from 'vitest';
import {
  computeHealthStatus,
  describeEmbeddedSignupError,
  generateRegistrationPin,
  isExpiredCodeError,
  isPermissionError,
  isPinMismatchError,
} from './embedded-signup';

describe('generateRegistrationPin', () => {
  it('always returns a 6-digit string, zero-padded', () => {
    for (let i = 0; i < 50; i++) {
      const pin = generateRegistrationPin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});

describe('isPinMismatchError', () => {
  it('detects an existing-PIN conflict', () => {
    expect(isPinMismatchError('Incorrect pin was provided.')).toBe(true);
    expect(
      isPinMismatchError('Two-step verification PIN required. Set one in Meta WhatsApp Manager.'),
    ).toBe(true);
  });
  it('does not flag unrelated errors', () => {
    expect(isPinMismatchError('Internal server error')).toBe(false);
  });
});

describe('isExpiredCodeError', () => {
  it('detects an expired/reused authorization code', () => {
    expect(isExpiredCodeError('This authorization code has expired.')).toBe(true);
    expect(isExpiredCodeError('The provided code is invalid.')).toBe(true);
  });
  it('does not flag unrelated errors', () => {
    expect(isExpiredCodeError('Insufficient permissions')).toBe(false);
  });
});

describe('isPermissionError', () => {
  it('detects missing/insufficient permissions', () => {
    expect(isPermissionError('Insufficient permissions to perform this action.')).toBe(true);
    expect(isPermissionError('(#200) Requires whatsapp_business_management permission')).toBe(true);
  });
  it('does not flag unrelated errors', () => {
    expect(isPermissionError('This authorization code has expired.')).toBe(false);
  });
});

describe('describeEmbeddedSignupError', () => {
  it('gives a friendly message for an expired code', () => {
    expect(describeEmbeddedSignupError('This authorization code has expired.')).toMatch(
      /click Connect WhatsApp again/,
    );
  });
  it('gives a friendly message for a PIN mismatch', () => {
    expect(describeEmbeddedSignupError('Incorrect pin was provided.')).toMatch(/Advanced setup/);
  });
  it('gives a friendly message for a permission error', () => {
    expect(describeEmbeddedSignupError('Insufficient permissions')).toMatch(/permissions WhatsApp needs/);
  });
  it('falls back to the raw message for anything unrecognized', () => {
    expect(describeEmbeddedSignupError('Some brand-new Meta error')).toBe(
      'Some brand-new Meta error',
    );
  });
});

describe('computeHealthStatus', () => {
  it('is disconnected when there is no config', () => {
    expect(
      computeHealthStatus({
        hasConfig: false,
        registeredAt: null,
        qualityRating: null,
        lastRegistrationError: null,
      }),
    ).toBe('disconnected');
  });

  it('needs action when never registered', () => {
    expect(
      computeHealthStatus({
        hasConfig: true,
        registeredAt: null,
        qualityRating: null,
        lastRegistrationError: null,
      }),
    ).toBe('action_needed');
  });

  it('needs action when there is a pending registration error, even if registered before', () => {
    expect(
      computeHealthStatus({
        hasConfig: true,
        registeredAt: '2026-01-01T00:00:00Z',
        qualityRating: 'GREEN',
        lastRegistrationError: 'Some transient failure',
      }),
    ).toBe('action_needed');
  });

  it('needs action on a RED quality rating', () => {
    expect(
      computeHealthStatus({
        hasConfig: true,
        registeredAt: '2026-01-01T00:00:00Z',
        qualityRating: 'RED',
        lastRegistrationError: null,
      }),
    ).toBe('action_needed');
  });

  it('is healthy when registered, no error, and quality is not RED', () => {
    expect(
      computeHealthStatus({
        hasConfig: true,
        registeredAt: '2026-01-01T00:00:00Z',
        qualityRating: 'GREEN',
        lastRegistrationError: null,
      }),
    ).toBe('healthy');
    expect(
      computeHealthStatus({
        hasConfig: true,
        registeredAt: '2026-01-01T00:00:00Z',
        qualityRating: null,
        lastRegistrationError: null,
      }),
    ).toBe('healthy');
  });
});
