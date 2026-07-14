import { describe, expect, it } from 'vitest'
import { contactSourceLabel } from './source-label'

describe('contactSourceLabel', () => {
  it('maps every known source to a human label', () => {
    expect(contactSourceLabel('manual')).toBe('Manual entry')
    expect(contactSourceLabel('import')).toBe('CSV import')
    expect(contactSourceLabel('api')).toBe('API')
    expect(contactSourceLabel('whatsapp_inbound')).toBe('Inbound WhatsApp message')
  })

  it('falls back to Unknown for null/undefined (pre-migration rows)', () => {
    expect(contactSourceLabel(null)).toBe('Unknown')
    expect(contactSourceLabel(undefined)).toBe('Unknown')
  })
})
