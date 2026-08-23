import { describe, expect, it } from 'vitest';
import { shouldTestBatchFirst, TEST_BATCH_THRESHOLD, TEST_BATCH_SIZE } from './test-batch';

describe('shouldTestBatchFirst', () => {
  it('is false at and below the threshold', () => {
    expect(shouldTestBatchFirst(0)).toBe(false);
    expect(shouldTestBatchFirst(1)).toBe(false);
    expect(shouldTestBatchFirst(TEST_BATCH_THRESHOLD)).toBe(false);
  });

  it('is true above the threshold', () => {
    expect(shouldTestBatchFirst(TEST_BATCH_THRESHOLD + 1)).toBe(true);
    expect(shouldTestBatchFirst(10_000)).toBe(true);
  });

  it('keeps the test batch smaller than the threshold', () => {
    expect(TEST_BATCH_SIZE).toBeLessThan(TEST_BATCH_THRESHOLD);
  });
});
