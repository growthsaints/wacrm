import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveConsentStatus,
  recordConsentResponse,
  recordImplicitConsentFromInboundMessage,
  CONSENT_YES_PAYLOAD,
  CONSENT_NO_PAYLOAD,
} from './consent';

describe('resolveConsentStatus', () => {
  it('maps YES_CONSENT to opted_in and NO_CONSENT to opted_out', () => {
    expect(resolveConsentStatus(CONSENT_YES_PAYLOAD)).toBe('opted_in');
    expect(resolveConsentStatus(CONSENT_NO_PAYLOAD)).toBe('opted_out');
  });

  it('returns null for any other payload', () => {
    expect(resolveConsentStatus('some_other_button')).toBeNull();
    expect(resolveConsentStatus('')).toBeNull();
  });
});

function makeDb(opts: {
  updateResult?: { data: unknown; error: { message: string } | null };
  optOutError?: { message: string } | null;
}) {
  const consentUpdate = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () =>
            opts.updateResult ?? { data: { id: 'row-1' }, error: null },
        }),
      }),
    }),
  }));
  const contactsUpdate = vi.fn(() => ({
    eq: async () => ({ error: opts.optOutError ?? null }),
  }));

  const from = vi.fn((table: string) => {
    if (table === 'contact_consent') return { update: consentUpdate };
    if (table === 'contacts') return { update: contactsUpdate };
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, consentUpdate, contactsUpdate } as unknown as SupabaseClient & {
    consentUpdate: typeof consentUpdate;
    contactsUpdate: typeof contactsUpdate;
  };
}

describe('recordConsentResponse', () => {
  it('does nothing for a non-consent button payload', async () => {
    const db = makeDb({});
    await recordConsentResponse(db, 'acct-1', 'contact-1', '+14155550123', 'unrelated_button');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('updates contact_consent to opted_in on YES_CONSENT, without touching contacts', async () => {
    const db = makeDb({});
    await recordConsentResponse(
      db,
      'acct-1',
      'contact-1',
      '+1 (415) 555-0123',
      CONSENT_YES_PAYLOAD
    );
    expect(db.consentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        consent_status: 'opted_in',
        consent_response_payload: CONSENT_YES_PAYLOAD,
        contact_id: 'contact-1',
      })
    );
    expect(db.contactsUpdate).not.toHaveBeenCalled();
  });

  it('updates contact_consent to opted_out AND syncs contacts.marketing_opt_out on NO_CONSENT', async () => {
    const db = makeDb({});
    await recordConsentResponse(db, 'acct-1', 'contact-1', '+14155550123', CONSENT_NO_PAYLOAD);
    expect(db.consentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ consent_status: 'opted_out' })
    );
    expect(db.contactsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ marketing_opt_out: true })
    );
  });

  it('is a no-op when no pending row matched (does not sync opt-out)', async () => {
    const db = makeDb({ updateResult: { data: null, error: null } });
    await recordConsentResponse(db, 'acct-1', 'contact-1', '+14155550123', CONSENT_NO_PAYLOAD);
    expect(db.contactsUpdate).not.toHaveBeenCalled();
  });

  it('swallows a DB error on the consent update rather than throwing', async () => {
    const db = makeDb({ updateResult: { data: null, error: { message: 'boom' } } });
    await expect(
      recordConsentResponse(db, 'acct-1', 'contact-1', '+14155550123', CONSENT_YES_PAYLOAD)
    ).resolves.toBeUndefined();
    expect(db.contactsUpdate).not.toHaveBeenCalled();
  });

  it('swallows a thrown error (e.g. malformed db) rather than throwing', async () => {
    const db = {} as unknown as SupabaseClient;
    await expect(
      recordConsentResponse(db, 'acct-1', 'contact-1', '+14155550123', CONSENT_YES_PAYLOAD)
    ).resolves.toBeUndefined();
  });
});

describe('recordImplicitConsentFromInboundMessage', () => {
  function makeInsertDb(error: { code: string; message: string } | null) {
    const insert = vi.fn(async () => ({ error }));
    const from = vi.fn(() => ({ insert }));
    return { from, insert } as unknown as SupabaseClient & { insert: typeof insert };
  }

  it('inserts an opted_in row sourced as whatsapp_inbound, sanitizing the phone', async () => {
    const db = makeInsertDb(null);
    await recordImplicitConsentFromInboundMessage(
      db,
      'acct-1',
      'contact-1',
      '+1 (415) 555-0123'
    );
    expect(db.insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      phone_number: '14155550123',
      source: 'whatsapp_inbound',
      consent_status: 'opted_in',
    });
  });

  it('treats a unique-violation (an existing tracked row) as a silent no-op', async () => {
    const db = makeInsertDb({ code: '23505', message: 'duplicate' });
    await expect(
      recordImplicitConsentFromInboundMessage(db, 'acct-1', 'contact-1', '+14155550123')
    ).resolves.toBeUndefined();
  });

  it('logs but does not throw on a non-conflict DB error', async () => {
    const db = makeInsertDb({ code: '55000', message: 'db hiccup' });
    await expect(
      recordImplicitConsentFromInboundMessage(db, 'acct-1', 'contact-1', '+14155550123')
    ).resolves.toBeUndefined();
  });

  it('swallows a thrown error rather than throwing', async () => {
    const db = {} as unknown as SupabaseClient;
    await expect(
      recordImplicitConsentFromInboundMessage(db, 'acct-1', 'contact-1', '+14155550123')
    ).resolves.toBeUndefined();
  });
});
