// ============================================================
// Derive this deployment's canonical base URL, for building the
// `webhook_url` returned by POST /api/v1/payment-gateways and
// POST /api/v1/shipping-configs.
//
// Prefers the explicit `NEXT_PUBLIC_SITE_URL` (see .env.local.example)
// and falls back to the request's own Host header. Unlike the invite-
// link resolver in `/api/account/invitations` (which guards against a
// spoofed Host header being emailed to a third party as a phishing
// link), the URL here is returned directly to the authenticated caller
// who made the request — they already know their own domain, so a
// spoofed Host only misleads the spoofer, not a third party. No
// allow-list gate is needed for that reason.
// ============================================================

export function getApiBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host) {
    const reqProto = new URL(request.url).protocol.replace(':', '');
    return `${reqProto}://${host}`;
  }

  return 'https://wacrm.tech';
}
