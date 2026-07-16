import fs from 'node:fs/promises'
import path from 'node:path'
import type { Boom } from '@hapi/boom'
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  // Aliased away from its original name — it's a plain Node.js
  // helper, not a React Hook, but eslint-plugin-react-hooks flags any
  // `use`-prefixed function call outside a component/hook body.
  useMultiFileAuthState as loadMultiFileAuthState,
  type WASocket,
} from 'baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import { platformAdminClient } from '@/lib/platform/admin-client'

// ============================================================
// QR-linked personal WhatsApp connections — Business Workspace's
// "connect your own WhatsApp Business app" feature (1:1 chat capture
// only, NEVER wired to broadcasts/campaigns). Completely independent
// from the official Cloud API module (whatsapp_config, meta-api.ts,
// /api/whatsapp/*) — nothing here is imported by, or shares state
// with, that code path.
//
// Baileys is an unofficial, reverse-engineered client for WhatsApp's
// multi-device "linked device" protocol — the same mechanism
// WhatsApp's own web/desktop clients use. It is NOT Meta's sanctioned
// third-party integration path (that's the Cloud API), so numbers
// connected this way carry a real risk of being flagged or banned by
// WhatsApp if used for anything beyond normal, human-paced 1:1
// messaging — which is exactly why this module never offers bulk
// sending on this channel.
//
// Session credentials (auth keys) live ONLY on this VPS's local disk
// under WHATSAPP_PERSONAL_SESSION_DIR (default ./.whatsapp-sessions),
// never in Supabase — the DB only tracks connection status/metadata
// for the UI. This directory must survive `pm2 restart` (it does,
// it's local disk) but will NOT survive moving to a fresh
// container/VPS without copying it — a fresh QR scan is needed in
// that case. The library's own docs note file-based auth state is a
// "bot-level" pattern, not a robust production one; treat this as a
// v1, not a scale-tested integration.
//
// In-memory Map below only works because this app runs as a single
// long-lived `next start` process under PM2 (fork mode, no
// clustering) — if that ever changes to multiple instances, this
// state needs to move to a shared store.
// ============================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected'

interface ConnectionState {
  socket: WASocket | null
  status: ConnectionStatus
  qrDataUrl: string | null
  phoneNumber: string | null
}

const connections = new Map<string, ConnectionState>()

function sessionDir(accountId: string): string {
  const base =
    process.env.WHATSAPP_PERSONAL_SESSION_DIR ||
    path.join(/* turbopackIgnore: true */ process.cwd(), '.whatsapp-sessions')
  return path.join(base, accountId)
}

function silentLogger() {
  return pino({ level: 'silent' })
}

async function persistStatus(
  accountId: string,
  patch: {
    status: ConnectionStatus
    phoneNumber?: string | null
    connectedAt?: string | null
    lastDisconnectedAt?: string | null
  },
): Promise<void> {
  const admin = platformAdminClient()
  const update: Record<string, unknown> = { status: patch.status }
  if ('phoneNumber' in patch) update.phone_number = patch.phoneNumber
  if ('connectedAt' in patch) update.connected_at = patch.connectedAt
  if ('lastDisconnectedAt' in patch) update.last_disconnected_at = patch.lastDisconnectedAt

  const { error } = await admin
    .from('workspace_whatsapp_connections')
    .upsert({ account_id: accountId, ...update }, { onConflict: 'account_id' })
  if (error) console.error('[whatsapp-personal] failed to persist status:', error)
}

export function getConnectionState(accountId: string): {
  status: ConnectionStatus
  qrDataUrl: string | null
  phoneNumber: string | null
} {
  const conn = connections.get(accountId)
  if (!conn) return { status: 'disconnected', qrDataUrl: null, phoneNumber: null }
  return { status: conn.status, qrDataUrl: conn.qrDataUrl, phoneNumber: conn.phoneNumber }
}

/** Starts (or resumes) a connection attempt. No-op if already connecting/connected. */
export async function startConnection(accountId: string): Promise<void> {
  const existing = connections.get(accountId)
  if (existing && existing.status !== 'disconnected') return

  const state: ConnectionState = { socket: null, status: 'connecting', qrDataUrl: null, phoneNumber: null }
  connections.set(accountId, state)
  await persistStatus(accountId, { status: 'connecting' })

  const dir = sessionDir(accountId)
  await fs.mkdir(dir, { recursive: true })
  const { state: authState, saveCreds } = await loadMultiFileAuthState(dir)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: authState,
    logger: silentLogger(),
  })
  state.socket = socket

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      state.status = 'qr_pending'
      state.qrDataUrl = await QRCode.toDataURL(qr)
      await persistStatus(accountId, { status: 'qr_pending' })
    }

    if (connection === 'open') {
      state.status = 'connected'
      state.qrDataUrl = null
      state.phoneNumber = socket.user?.id ? socket.user.id.split(':')[0].split('@')[0] : null
      await persistStatus(accountId, {
        status: 'connected',
        phoneNumber: state.phoneNumber,
        connectedAt: new Date().toISOString(),
      })
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      state.status = 'disconnected'
      state.qrDataUrl = null
      await persistStatus(accountId, { status: 'disconnected', lastDisconnectedAt: new Date().toISOString() })

      if (loggedOut) {
        connections.delete(accountId)
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      } else {
        // Transient drop (network blip, server restart mid-session) —
        // retry with the same saved credentials rather than forcing a
        // fresh QR scan.
        setTimeout(() => {
          startConnection(accountId).catch((err) => console.error('[whatsapp-personal] reconnect failed:', err))
        }, 5000)
      }
    }
  })
}

/** Logs out, wipes the local session, and marks the connection disconnected. */
export async function disconnectConnection(accountId: string): Promise<void> {
  const conn = connections.get(accountId)
  if (conn?.socket) {
    await conn.socket.logout().catch(() => {})
  }
  connections.delete(accountId)
  await fs.rm(sessionDir(accountId), { recursive: true, force: true }).catch(() => {})
  await persistStatus(accountId, {
    status: 'disconnected',
    phoneNumber: null,
    lastDisconnectedAt: new Date().toISOString(),
  })
}

/**
 * Called once from instrumentation.ts on server boot — resumes every
 * tenant whose connection was last known as 'connected' using their
 * saved local session, without needing a fresh QR scan (as long as
 * the session hasn't been invalidated from the phone's side).
 */
export async function reconnectAllOnBoot(): Promise<void> {
  const admin = platformAdminClient()
  const { data, error } = await admin.from('workspace_whatsapp_connections').select('account_id').eq('status', 'connected')
  if (error) {
    console.error('[whatsapp-personal] boot reconnect query failed:', error)
    return
  }
  for (const row of (data ?? []) as Array<{ account_id: string }>) {
    startConnection(row.account_id).catch((err) => console.error('[whatsapp-personal] boot reconnect failed:', err))
  }
}
