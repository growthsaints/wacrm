// ============================================================
// Gateway → adapter registry. The receiver route resolves the
// adapter from `payment_gateway_configs.gateway`, never hardcodes
// Razorpay directly, so a second gateway is additive here.
// ============================================================

import type { PaymentGateway, PaymentGatewayAdapter } from './gateway';
import { razorpayAdapter } from './razorpay';

const ADAPTERS: Record<PaymentGateway, PaymentGatewayAdapter> = {
  razorpay: razorpayAdapter,
};

export function getGatewayAdapter(gateway: PaymentGateway): PaymentGatewayAdapter {
  return ADAPTERS[gateway];
}
