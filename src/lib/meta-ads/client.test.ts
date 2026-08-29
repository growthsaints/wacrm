import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  addPhonesToCustomAudience,
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  createCarouselAdCreative,
  createCustomAudience,
  createVideoAdCreative,
  getAdReviewStatus,
  getVideoStatus,
  hashPhoneForCustomAudience,
  listPages,
  setCampaignDeliveryStatus,
  uploadAdImageFromUrl,
  uploadAdVideoFromUrl,
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

  it("prefers Meta's end-user-facing error_user_msg/title over the generic message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: 'Permissions error',
              error_subcode: 1870090,
              error_user_title: 'Custom audience terms not accepted',
              error_user_msg: 'You must accept the terms at https://business.facebook.com/ads/manage/customaudiences/tos/?act=123',
            },
          },
          false,
          400,
        ),
      ),
    )

    await expect(verifyAdAccount({ accessToken: 'tok', adAccountId: '1' })).rejects.toThrow(
      'Custom audience terms not accepted: You must accept the terms at https://business.facebook.com/ads/manage/customaudiences/tos/?act=123',
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

describe('listPages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the data array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain('/me/accounts')
        return jsonResponse({ data: [{ id: 'page-1', name: 'Oaks Overseas' }] })
      }),
    )
    const pages = await listPages('tok')
    expect(pages).toEqual([{ id: 'page-1', name: 'Oaks Overseas' }])
  })
})

describe('uploadAdImageFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the image then uploads its base64 bytes, returning the hash', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://example.com/pic.jpg') {
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-image-bytes').buffer } as unknown as Response
      }
      expect(url).toContain('/adimages')
      const body = JSON.parse((init as RequestInit).body as string)
      expect(typeof body.bytes).toBe('string')
      return jsonResponse({ images: { 'file.jpg': { hash: 'img-hash-1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadAdImageFromUrl({
      accessToken: 'tok',
      adAccountId: 'act_1',
      imageUrl: 'https://example.com/pic.jpg',
    })
    expect(result.hash).toBe('img-hash-1')
  })

  it("throws if the image itself can't be fetched", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))
    await expect(
      uploadAdImageFromUrl({ accessToken: 'tok', adAccountId: 'act_1', imageUrl: 'https://example.com/x.jpg' }),
    ).rejects.toThrow('Could not fetch the ad image')
  })
})

describe('createCampaign', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always creates the campaign PAUSED with the confirmed objective', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Test campaign',
        objective: 'OUTCOME_ENGAGEMENT',
        status: 'PAUSED',
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false,
      })
      return jsonResponse({ id: 'camp-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createCampaign({ accessToken: 'tok', adAccountId: 'act_1', name: 'Test campaign' })
    expect(result.id).toBe('camp-1')
  })
})

describe('createAdSet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the confirmed WhatsApp destination shape and includes the custom audience', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Ad set',
        campaign_id: 'camp-1',
        optimization_goal: 'CONVERSATIONS',
        billing_event: 'IMPRESSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'WHATSAPP',
        promoted_object: { page_id: 'page-1' },
        targeting: {
          geo_locations: { countries: ['IN'] },
          publisher_platforms: ['facebook'],
          targeting_automation: { advantage_audience: 0 },
          custom_audiences: [{ id: 'aud-1' }],
        },
        daily_budget: 10000,
        status: 'PAUSED',
      })
      return jsonResponse({ id: 'adset-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createAdSet({
      accessToken: 'tok',
      adAccountId: 'act_1',
      campaignId: 'camp-1',
      name: 'Ad set',
      pageId: 'page-1',
      dailyBudgetMajorUnits: 100,
      customAudienceId: 'aud-1',
    })
    expect(result.id).toBe('adset-1')
  })

  it('omits custom_audiences when none is given', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.targeting).toEqual({
        geo_locations: { countries: ['IN'] },
        publisher_platforms: ['facebook'],
        targeting_automation: { advantage_audience: 0 },
      })
      return jsonResponse({ id: 'adset-2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createAdSet({
      accessToken: 'tok',
      adAccountId: 'act_1',
      campaignId: 'camp-1',
      name: 'Ad set',
      pageId: 'page-1',
      dailyBudgetMajorUnits: 50,
    })
  })
})

describe('createAdCreative', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds link_data with the WhatsApp call_to_action and an optional image', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Creative',
        object_story_spec: {
          page_id: 'page-1',
          link_data: {
            message: 'Hello!',
            link: 'https://wa.me/',
            call_to_action: { type: 'WHATSAPP_MESSAGE' },
            image_hash: 'img-hash-1',
          },
        },
      })
      return jsonResponse({ id: 'creative-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createAdCreative({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'Creative',
      pageId: 'page-1',
      message: 'Hello!',
      imageHash: 'img-hash-1',
    })
    expect(result.id).toBe('creative-1')
  })

  it('adds name/description when a headline/description is given', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.object_story_spec.link_data).toEqual({
        message: 'Hello!',
        link: 'https://wa.me/',
        call_to_action: { type: 'WHATSAPP_MESSAGE' },
        image_hash: 'img-hash-1',
        name: 'Big Sale',
        description: '20% off this week',
      })
      return jsonResponse({ id: 'creative-2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createAdCreative({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'Creative',
      pageId: 'page-1',
      message: 'Hello!',
      imageHash: 'img-hash-1',
      headline: 'Big Sale',
      description: '20% off this week',
    })
  })
})

describe('createAd', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always creates the ad PAUSED', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Ad',
        adset_id: 'adset-1',
        creative: { creative_id: 'creative-1' },
        status: 'PAUSED',
      })
      return jsonResponse({ id: 'ad-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createAd({
      accessToken: 'tok',
      adAccountId: 'act_1',
      adsetId: 'adset-1',
      creativeId: 'creative-1',
      name: 'Ad',
    })
    expect(result.id).toBe('ad-1')
  })
})

describe('setCampaignDeliveryStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets status on the campaign, ad set, and ad', async () => {
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calledUrls.push(url)
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({ status: 'ACTIVE' })
      return jsonResponse({ success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await setCampaignDeliveryStatus({
      accessToken: 'tok',
      campaignId: 'camp-1',
      adSetId: 'adset-1',
      adId: 'ad-1',
      status: 'ACTIVE',
    })

    expect(calledUrls).toEqual([
      `${'https://graph.facebook.com/v21.0'}/camp-1`,
      `${'https://graph.facebook.com/v21.0'}/adset-1`,
      `${'https://graph.facebook.com/v21.0'}/ad-1`,
    ])
  })

  it("throws Meta's own error and stops on the first failure", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Ad account is restricted' } }, false, 403),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      setCampaignDeliveryStatus({
        accessToken: 'tok',
        campaignId: 'camp-1',
        adSetId: 'adset-1',
        adId: 'ad-1',
        status: 'PAUSED',
      }),
    ).rejects.toThrow('Ad account is restricted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('uploadAdVideoFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('form-encodes file_url and title, returning the video id', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/advideos')
      const body = init.body as URLSearchParams
      expect(body.get('file_url')).toBe('https://example.com/clip.mp4')
      expect(body.get('title')).toBe('My video')
      return jsonResponse({ id: 'video-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadAdVideoFromUrl({
      accessToken: 'tok',
      adAccountId: 'act_1',
      videoUrl: 'https://example.com/clip.mp4',
      title: 'My video',
    })
    expect(result.videoId).toBe('video-1')
  })
})

describe('getVideoStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports ready with a thumbnail once processing completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: { video_status: 'ready' }, picture: 'https://example.com/thumb.jpg' }),
      ),
    )
    const status = await getVideoStatus({ accessToken: 'tok', videoId: 'video-1' })
    expect(status).toEqual({ ready: true, thumbnailUrl: 'https://example.com/thumb.jpg' })
  })

  it('reports not ready while still processing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: { video_status: 'processing' } })))
    const status = await getVideoStatus({ accessToken: 'tok', videoId: 'video-1' })
    expect(status).toEqual({ ready: false, thumbnailUrl: null })
  })
})

describe('createVideoAdCreative', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds video_data with the WhatsApp call_to_action', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Video creative',
        object_story_spec: {
          page_id: 'page-1',
          video_data: {
            video_id: 'video-1',
            image_url: 'https://example.com/thumb.jpg',
            message: 'Hello!',
            call_to_action: { type: 'WHATSAPP_MESSAGE' },
          },
        },
      })
      return jsonResponse({ id: 'creative-video-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createVideoAdCreative({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'Video creative',
      pageId: 'page-1',
      videoId: 'video-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      message: 'Hello!',
    })
    expect(result.id).toBe('creative-video-1')
  })

  it('adds title when a headline is given', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.object_story_spec.video_data).toEqual({
        video_id: 'video-1',
        image_url: 'https://example.com/thumb.jpg',
        message: 'Hello!',
        call_to_action: { type: 'WHATSAPP_MESSAGE' },
        title: 'Big Sale',
      })
      return jsonResponse({ id: 'creative-video-2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createVideoAdCreative({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'Video creative',
      pageId: 'page-1',
      videoId: 'video-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      message: 'Hello!',
      headline: 'Big Sale',
    })
  })
})

describe('createCarouselAdCreative', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds link_data.child_attachments matching the ground-truth schema', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        name: 'Carousel creative',
        object_story_spec: {
          page_id: 'page-1',
          link_data: {
            message: 'Hello!',
            link: 'https://wa.me/',
            call_to_action: { type: 'WHATSAPP_MESSAGE' },
            child_attachments: [
              {
                link: 'https://wa.me/',
                image_hash: 'hash-1',
                name: 'Card one',
                description: 'First',
                call_to_action: { type: 'WHATSAPP_MESSAGE' },
              },
              {
                link: 'https://wa.me/',
                image_hash: 'hash-2',
                name: 'Card two',
                description: '',
                call_to_action: { type: 'WHATSAPP_MESSAGE' },
              },
            ],
          },
        },
      })
      return jsonResponse({ id: 'creative-carousel-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createCarouselAdCreative({
      accessToken: 'tok',
      adAccountId: 'act_1',
      name: 'Carousel creative',
      pageId: 'page-1',
      message: 'Hello!',
      cards: [
        { imageHash: 'hash-1', headline: 'Card one', description: 'First' },
        { imageHash: 'hash-2', headline: 'Card two' },
      ],
    })
    expect(result.id).toBe('creative-carousel-1')
  })
})

describe('getAdReviewStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns effective_status with no feedback when the ad has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain('/ad-1')
        expect(url).toContain('ad_review_feedback')
        return jsonResponse({ effective_status: 'PAUSED', id: 'ad-1' })
      }),
    )
    const result = await getAdReviewStatus({ accessToken: 'tok', adId: 'ad-1' })
    expect(result).toEqual({ effectiveStatus: 'PAUSED', reviewFeedback: null })
  })

  it('surfaces review feedback when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          effective_status: 'DISAPPROVED',
          ad_review_feedback: { global: 'AD_DISAPPROVED_TARGETING' },
        }),
      ),
    )
    const result = await getAdReviewStatus({ accessToken: 'tok', adId: 'ad-1' })
    expect(result).toEqual({
      effectiveStatus: 'DISAPPROVED',
      reviewFeedback: { global: 'AD_DISAPPROVED_TARGETING' },
    })
  })
})
