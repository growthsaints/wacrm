/**
 * Test-batch-first gating for large broadcasts. Sending a template to a
 * fresh, unvalidated audience of hundreds/thousands of contacts in one
 * shot is exactly the traffic pattern that trips Meta's quality-rating
 * enforcement before anyone notices a problem — a small sample first
 * (with a required human confirmation before the rest goes out) catches
 * a bad template/audience while the blast radius is still small.
 *
 * Shared between the dashboard wizard (`use-broadcast-sending.ts`) and
 * the public-API broadcast core (`broadcast-core.ts`) so both send
 * paths apply the same rule — no DB/framework dependency, safe to
 * import from a client component.
 */
export const TEST_BATCH_THRESHOLD = 50;
export const TEST_BATCH_SIZE = 10;

export function shouldTestBatchFirst(totalRecipients: number): boolean {
  return totalRecipients > TEST_BATCH_THRESHOLD;
}
