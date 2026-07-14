import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeEmbeddedSignupCode,
  getBusinessDetails,
  getWabaDetails,
  verifyPhoneNumber,
} from './meta-api';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('exchangeEmbeddedSignupCode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('GETs /oauth/access_token with client_id, client_secret, and code', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ access_token: 'long-lived-token', token_type: 'bearer', expires_in: 5184000 }),
    );
    const result = await exchangeEmbeddedSignupCode({
      appId: 'APP_1',
      appSecret: 'SECRET',
      code: 'auth-code',
    });
    expect(result).toEqual({
      accessToken: 'long-lived-token',
      tokenType: 'bearer',
      expiresIn: 5184000,
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/oauth/access_token');
    expect(url).toContain('client_id=APP_1');
    expect(url).toContain('client_secret=SECRET');
    expect(url).toContain('code=auth-code');
  });

  it('throws with the expired-code message surfaced verbatim', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, { error: { message: 'This authorization code has expired.' } }),
    );
    await expect(
      exchangeEmbeddedSignupCode({ appId: 'A', appSecret: 'S', code: 'stale' }),
    ).rejects.toThrow(/expired/);
  });

  it('throws when Meta omits an access_token', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ token_type: 'bearer' }));
    await expect(
      exchangeEmbeddedSignupCode({ appId: 'A', appSecret: 'S', code: 'c' }),
    ).rejects.toThrow(/did not return an access token/);
  });
});

describe('getWabaDetails', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the WABA name', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'WABA_1', name: 'Acme WABA' }));
    const result = await getWabaDetails({ wabaId: 'WABA_1', accessToken: 'tok' });
    expect(result.name).toBe('Acme WABA');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/WABA_1');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, { error: { message: 'Insufficient permission' } }));
    await expect(getWabaDetails({ wabaId: 'WABA_1', accessToken: 'tok' })).rejects.toThrow(
      /Insufficient permission/,
    );
  });
});

describe('getBusinessDetails', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the Business Manager name', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'BIZ_1', name: 'Acme Inc' }));
    const result = await getBusinessDetails({ businessId: 'BIZ_1', accessToken: 'tok' });
    expect(result.name).toBe('Acme Inc');
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, { error: { message: 'Unknown business' } }));
    await expect(
      getBusinessDetails({ businessId: 'BIZ_1', accessToken: 'tok' }),
    ).rejects.toThrow(/Unknown business/);
  });
});

describe('verifyPhoneNumber — widened fields', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests and returns quality/messaging-limit/verification fields', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'PNID_1',
        display_phone_number: '+1 415-555-0123',
        verified_name: 'Acme Support',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
        messaging_limit_tier: 'TIER_1K',
      }),
    );
    const result = await verifyPhoneNumber({ phoneNumberId: 'PNID_1', accessToken: 'tok' });
    expect(result.quality_rating).toBe('GREEN');
    expect(result.code_verification_status).toBe('VERIFIED');
    expect(result.messaging_limit_tier).toBe('TIER_1K');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('code_verification_status');
    expect(url).toContain('messaging_limit_tier');
  });
});
