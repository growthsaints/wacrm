// Meta Ads access tokens use the exact same AES-256-GCM cipher and
// ENCRYPTION_KEY as WhatsApp/SMS-Gateway/httpSMS — no reason to
// duplicate it.
export { encrypt, decrypt } from '@/lib/whatsapp/encryption'
