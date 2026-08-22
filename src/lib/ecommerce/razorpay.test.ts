import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyRazorpaySignature,
  mapRazorpayEvent,
  razorpayIdempotencyKey,
} from './razorpay';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyRazorpaySignature', () => {
  const secret = 'whsec_test_secret';
  const body = '{"event":"payment.captured"}';

  it('accepts a correctly signed body', () => {
    expect(verifyRazorpaySignature(body, sign(body, secret), secret)).toBe(
      true
    );
  });

  it('rejects a tampered body', () => {
    const tampered = body.replace('captured', 'failed');
    expect(verifyRazorpaySignature(tampered, sign(body, secret), secret)).toBe(
      false
    );
  });

  it('rejects the wrong secret', () => {
    expect(
      verifyRazorpaySignature(body, sign(body, secret), 'wrong-secret')
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyRazorpaySignature(body, null, secret)).toBe(false);
  });

  it('is case-insensitive on the presented hex digest', () => {
    expect(
      verifyRazorpaySignature(body, sign(body, secret).toUpperCase(), secret)
    ).toBe(true);
  });
});

const paymentCaptured = {
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_ABC123',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_XYZ',
        method: 'upi',
        contact: '+919876543210',
        notes: { customer_name: 'Rahul Sharma' },
      },
    },
  },
};

describe('mapRazorpayEvent', () => {
  it('maps payment.captured with contact + notes', () => {
    const mapped = mapRazorpayEvent(paymentCaptured);
    expect(mapped).toEqual({
      event: 'payment.captured',
      to: '+919876543210',
      name: 'Rahul Sharma',
      data: {
        payment: {
          id: 'pay_ABC123',
          amount: 500,
          amount_paise: 50000,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_XYZ',
          method: 'upi',
        },
      },
    });
  });

  it('maps refund.processed to payment.refunded', () => {
    const mapped = mapRazorpayEvent({
      event: 'refund.processed',
      payload: {
        payment: { entity: { id: 'pay_1', contact: '+919876543210' } },
        refund: {
          entity: { id: 'rfnd_1', amount: 10000, payment_id: 'pay_1' },
        },
      },
    });
    expect(mapped?.event).toBe('payment.refunded');
    expect(mapped?.data).toMatchObject({
      refund: { id: 'rfnd_1', amount: 100, payment_id: 'pay_1' },
    });
  });

  it('returns null for an unmapped event type', () => {
    expect(mapRazorpayEvent({ event: 'order.paid', payload: {} })).toBeNull();
  });

  it('returns null when there is no contact to notify', () => {
    expect(
      mapRazorpayEvent({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1' } } },
      })
    ).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(mapRazorpayEvent(null)).toBeNull();
    expect(mapRazorpayEvent('not an object')).toBeNull();
  });
});

describe('razorpayIdempotencyKey', () => {
  it('keys on the payment id for a payment event', () => {
    expect(razorpayIdempotencyKey(paymentCaptured)).toBe(
      'razorpay:payment.captured:pay_ABC123'
    );
  });

  it('prefers the refund id when a refund entity is present', () => {
    const key = razorpayIdempotencyKey({
      event: 'refund.processed',
      payload: {
        payment: { entity: { id: 'pay_1' } },
        refund: { entity: { id: 'rfnd_1' } },
      },
    });
    expect(key).toBe('razorpay:refund.processed:rfnd_1');
  });

  it('returns null when neither id is present', () => {
    expect(
      razorpayIdempotencyKey({ event: 'payment.captured', payload: {} })
    ).toBeNull();
  });
});
