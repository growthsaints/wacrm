// httpSMS config secrets (API key, webhook signing key) use the exact
// same AES-256-GCM cipher and ENCRYPTION_KEY as WhatsApp/SMS-Gateway —
// no reason to duplicate it.
export { encrypt, decrypt } from '@/lib/whatsapp/encryption'
