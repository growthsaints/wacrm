import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { dispatchEventToFlows } from '@/lib/flows/engine';

/**
 * POST /api/v1/flows/trigger  (scope: flows:trigger)
 *
 * Body: { flow_id?, contact_id? OR phone, name? }
 *
 * Starts a flow for a contact from outside WhatsApp entirely — the
 * `api` trigger type from Part 6. `flow_id` targets a specific flow;
 * omitting it dispatches the generic `api` event so any active
 * `api`-triggered flow can pick it up (mirrors how `tag_added` lets
 * multiple flows share one trigger type).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'flows:trigger');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!contactId && !phone) {
      return fail('bad_request', "Either 'contact_id' or 'phone' is required", 400);
    }

    let resolvedContactId = contactId;
    if (!resolvedContactId) {
      const resolved = await resolveConversationByPhone(
        ctx.supabase,
        ctx.accountId,
        phone,
        typeof body.name === 'string' ? body.name : null,
      );
      resolvedContactId = resolved.contactId;
    } else {
      const { data: owned } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', resolvedContactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!owned) {
        return fail('not_found', 'contact_id not found in this account', 404);
      }
    }

    const flowId = typeof body.flow_id === 'string' ? body.flow_id : null;
    if (flowId) {
      const { data: flow } = await ctx.supabase
        .from('flows')
        .select('id')
        .eq('id', flowId)
        .eq('account_id', ctx.accountId)
        .eq('status', 'active')
        .maybeSingle();
      if (!flow) {
        return fail('not_found', 'flow_id not found, inactive, or not owned by this account', 404);
      }
      const { startFlowRunForContact } = await import('@/lib/flows/engine');
      const result = await startFlowRunForContact(flowId, resolvedContactId);
      return ok({ contact_id: resolvedContactId, ...result }, 201);
    }

    const result = await dispatchEventToFlows({
      accountId: ctx.accountId,
      contactId: resolvedContactId,
      triggerType: 'api',
    });
    return ok({ contact_id: resolvedContactId, ...result }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
