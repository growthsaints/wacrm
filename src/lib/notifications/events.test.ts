import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENTS, isNotificationEvent } from './events';

describe('isNotificationEvent', () => {
  it('accepts every declared event', () => {
    for (const e of NOTIFICATION_EVENTS) expect(isNotificationEvent(e)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isNotificationEvent('order.exploded')).toBe(false);
    expect(isNotificationEvent('')).toBe(false);
    expect(isNotificationEvent(null)).toBe(false);
    expect(isNotificationEvent(42)).toBe(false);
  });

  it('has no duplicate or cross-namespace collisions', () => {
    expect(new Set(NOTIFICATION_EVENTS).size).toBe(NOTIFICATION_EVENTS.length);
  });
});
