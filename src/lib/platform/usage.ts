// ============================================================
// Pure date helpers for the Super Admin usage dashboard. Kept
// dependency-free so the "this month" window used by the
// organizations/overview API routes is unit-testable without a DB.
// ============================================================

/** ISO timestamp for the start of the given month, UTC. Defaults to now. */
export function startOfMonthIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
