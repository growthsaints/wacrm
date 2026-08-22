import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { razorpayAdapter } from './razorpay';

const SECRET = 'whsec_test_secret';

function sign(rawBody: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function headersWith(signature?: string): Headers {
  const h = new Headers();
  if (signature) h.set('x-razorpay-signature', signature);
  return h;
}

describe('razorpayAdapter.verifySignature', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"event":"payment.captured"}';
    expect(
      razorpayAdapter.verifySignature(body, headersWith(sign(body)), SECRET)
    ).toBe(true);
  });

  it('rejects a body signed with a different secret', () => {
    const body = '{"event":"payment.captured"}';
    expect(
      razorpayAdapter.verifySignature(
        body,
        headersWith(sign(body, 'wrong-secret')),
        SECRET
      )
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = '{"event":"payment.captured"}';
    const signature = sign(body);
    expect(
      razorpayAdapter.verifySignature(
        '{"event":"payment.failed"}',
        headersWith(signature),
        SECRET
      )
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(razorpayAdapter.verifySignature('{}', headersWith(), SECRET)).toBe(
      false
    );
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(
      razorpayAdapter.verifySignature('{}', headersWith('abcd'), SECRET)
    ).toBe(false);
  });
});

describe('razorpayAdapter.parseEvent', () => {
  it('returns null for unparseable JSON', () => {
    expect(razorpayAdapter.parseEvent('not json')).toBeNull();
  });

  it('maps payment.captured, extracting phone and formatted amount', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            amount: 49900,
            currency: 'INR',
            email: 'jane@example.com',
            contact: '+14155550123',
            order_id: 'order_1',
          },
        },
      },
    });
    const parsed = razorpayAdapter.parseEvent(body);
    expect(parsed).toEqual({
      event: 'payment.captured',
      phone: '+14155550123',
      data: {
        payment: {
          id: 'pay_123',
          amount: '499.00',
          currency: 'INR',
          email: 'jane@example.com',
          contact: '+14155550123',
          order_id: 'order_1',
        },
      },
      eventId: 'pay_123',
    });
  });

  it('maps payment.failed', () => {
    const body = JSON.stringify({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_2', amount: 1000, contact: '+1' } } },
    });
    expect(razorpayAdapter.parseEvent(body)?.event).toBe('payment.failed');
  });

  it('maps refund.processed to payment.refunded and reads the refund entity', () => {
    const body = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_1', amount: 5000, payment_id: 'pay_3' } },
        payment: { entity: { contact: '+14155550999' } },
      },
    });
    const parsed = razorpayAdapter.parseEvent(body);
    expect(parsed?.event).toBe('payment.refunded');
    expect(parsed?.data.payment).toMatchObject({ id: 'rfnd_1', amount: '50.00' });
    // Falls back to the sibling payment entity's contact when the
    // refund entity itself carries no phone.
    expect(parsed?.phone).toBe('+14155550999');
  });

  it('falls back to notes.phone when contact is absent', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_4', amount: 100, notes: { phone: '+19998887777' } } },
      },
    });
    expect(razorpayAdapter.parseEvent(body)?.phone).toBe('+19998887777');
  });

  it('returns event: null for a Razorpay event type wacrm does not act on', () => {
    const body = JSON.stringify({
      event: 'payment.authorized',
      payload: { payment: { entity: { id: 'pay_5' } } },
    });
    const parsed = razorpayAdapter.parseEvent(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.event).toBeNull();
  });

  it('returns phone: null when nothing in the payload carries one', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_6', amount: 100 } } },
    });
    expect(razorpayAdapter.parseEvent(body)?.phone).toBeNull();
  });
});
