import { describe, expect, it } from 'vitest';
import { getGatewayAdapter } from './registry';
import { razorpayAdapter } from './razorpay';

describe('getGatewayAdapter', () => {
  it('resolves "razorpay" to the Razorpay adapter', () => {
    expect(getGatewayAdapter('razorpay')).toBe(razorpayAdapter);
  });
});
