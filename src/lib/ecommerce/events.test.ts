import { describe, expect, it } from 'vitest';
import {
  ORDER_EVENTS,
  PAYMENT_EVENTS,
  SHIPMENT_EVENTS,
  NOTIFICATION_EVENTS,
  isOrderEvent,
  isShipmentEvent,
  isNotificationEvent,
} from './events';

describe('isOrderEvent', () => {
  it('accepts every declared order event', () => {
    for (const e of ORDER_EVENTS) expect(isOrderEvent(e)).toBe(true);
  });

  it('rejects payment/shipment events and garbage', () => {
    expect(isOrderEvent('payment.captured')).toBe(false);
    expect(isOrderEvent('shipment.delivered')).toBe(false);
    expect(isOrderEvent('')).toBe(false);
    expect(isOrderEvent(null)).toBe(false);
  });
});

describe('isShipmentEvent', () => {
  it('accepts every declared shipment event', () => {
    for (const e of SHIPMENT_EVENTS) expect(isShipmentEvent(e)).toBe(true);
  });

  it('rejects order events', () => {
    expect(isShipmentEvent('order.shipped')).toBe(false);
  });
});

describe('isNotificationEvent', () => {
  it('accepts the union of order, payment, and shipment events', () => {
    for (const e of NOTIFICATION_EVENTS)
      expect(isNotificationEvent(e)).toBe(true);
    for (const e of ORDER_EVENTS) expect(isNotificationEvent(e)).toBe(true);
    for (const e of PAYMENT_EVENTS) expect(isNotificationEvent(e)).toBe(true);
    for (const e of SHIPMENT_EVENTS) expect(isNotificationEvent(e)).toBe(true);
  });

  it('rejects an unknown event name', () => {
    expect(isNotificationEvent('order.exploded')).toBe(false);
    expect(isNotificationEvent(42)).toBe(false);
  });
});
