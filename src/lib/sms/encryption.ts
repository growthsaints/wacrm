// SMS config secrets (Basic Auth password, webhook HMAC secret) use the
// exact same AES-256-GCM cipher and ENCRYPTION_KEY as WhatsApp's
// access_token/verify_token — no reason to duplicate it.
export { encrypt, decrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
