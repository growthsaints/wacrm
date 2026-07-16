// Runs once when a new Next.js server instance starts (before it
// accepts requests). Used here to resume any Business Workspace
// personal-WhatsApp connections that were open when the server was
// last stopped (deploy restart, crash, etc.) — Baileys reconnects
// using the saved local session, no fresh QR scan needed.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reconnectAllOnBoot } = await import('@/lib/whatsapp-personal/socket-manager')
    await reconnectAllOnBoot().catch((err) => {
      console.error('[instrumentation] whatsapp-personal reconnectAllOnBoot failed:', err)
    })
  }
}
