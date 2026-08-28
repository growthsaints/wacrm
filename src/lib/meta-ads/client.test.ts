import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  addPhonesToCustomAudience,
  createCustomAudience,
  hashPhoneForCustomAudience,
  verifyAdAccount,
} from './client'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('hashPhoneForCustomAudience', () => {
  it('normalizes to digits-only and SHA-256 hashes it', () => {
    const expected = createHash('sha256').update('14155550123').digest('hex')
    expect(hashPhoneForCustomAudience('+1 (415) 555-0123')).toBe(expected)
  })

  it('produces the same hash regardless of formatting differences', () => {
    expect(hashPhoneForCustomAudience('+91 98765 43210')).toBe(
      hashPhoneForCustomAudience('919876543210'),
    )
  })
})

describe('verifyAdAccount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefixes a bare id with act_ and returns the parsed account', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/act_123456')
      return jsonResponse({ id: 'act_123456', name: 'growth saints', account_status: 1, currency: 'INR' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyAdAccount({ accessToken: 'tok', adAccountId: '123456' })
    expect(result.name).toBe('growth saints')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('act_123456'),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    )
  })

  it('does not double-prefix an id that already has act_', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).not.toContain('act_act_')
      return jsonResponse({ id: 'act_123456', name: 'x', account_status: 1, currency: 'INR' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await verifyAdAccount({ accessToken: 'tok', adAccountId: 'act_123456' })
  })

  it('throws Meta\'s own error message on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid OAuth access token' } }, false, 401)),
    )

    await expect(verifyAdAccount({ accessToken: 'bad', adAccountId: '1' })).rejects.toThrow(
      'Invalid OAuth access token',
    )
  })
})

describe('createCustomAudience', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the expected CUSTOM/USER_PROVIDED_ONLY shape', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'VIP customers',
        subtype: 'CUSTOM',
        customer_file_source: 'USER_PROVIDED_ONLY',
      })
      return jsonResponse({ id: 'aud-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createCustomAudience({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'VIP customers',
    })
    expect(result.id).toBe('aud-1')
  })
})

describe('addPhonesToCustomAudience', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch should not be called for an empty batch')
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('no-ops for an empty batch without calling fetch', async () => {
    await expect(addPhonesToCustomAudience({ accessToken: 'tok', metaAudienceId: 'aud-1', hashedPhones: [] })).resolves.toBeUndefined()
  })

  it('wraps each hash in its own row per Meta\'s PHONE schema', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.payload).toEqual({ schema: ['PHONE'], data: [['hash1'], ['hash2']] })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await addPhonesToCustomAudience({
      accessToken: 'tok',
      metaAudienceId: 'aud-1',
      hashedPhones: ['hash1', 'hash2'],
    })
  })
})
