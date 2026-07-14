import { describe, expect, it } from 'vitest';
import { checkPhoneNumberClaim } from './claim-check';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeClient(result: { data: unknown; error: unknown }) {
  const calls: { eqArgs: [string, unknown][]; neqArgs: [string, unknown][] } = {
    eqArgs: [],
    neqArgs: [],
  };
  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.eqArgs.push([col, val]);
      return builder;
    },
    neq(col: string, val: unknown) {
      calls.neqArgs.push([col, val]);
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    client: { from: () => builder } as unknown as SupabaseClient,
  };
}

describe('checkPhoneNumberClaim', () => {
  it('reports no claim when no other account owns the number', async () => {
    const { client, calls } = makeClient({ data: null, error: null });
    const result = await checkPhoneNumberClaim(client, 'PNID_1', 'acct-1');
    expect(result).toEqual({ claimedByAnotherAccount: false });
    expect(calls.eqArgs).toEqual([['phone_number_id', 'PNID_1']]);
    expect(calls.neqArgs).toEqual([['account_id', 'acct-1']]);
  });

  it('reports a claim when another account already owns the number', async () => {
    const { client } = makeClient({ data: { account_id: 'acct-2' }, error: null });
    const result = await checkPhoneNumberClaim(client, 'PNID_1', 'acct-1');
    expect(result).toEqual({ claimedByAnotherAccount: true });
  });

  it('throws a descriptive error when the query fails', async () => {
    const { client } = makeClient({ data: null, error: { message: 'connection reset' } });
    await expect(checkPhoneNumberClaim(client, 'PNID_1', 'acct-1')).rejects.toThrow(
      /connection reset/,
    );
  });
});
