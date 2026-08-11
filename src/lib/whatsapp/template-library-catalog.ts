/**
 * A local, hand-verified copy of a handful of entries from Meta's
 * Template Library catalog.
 *
 * Meta documents a live browse/search API for this catalog
 * (`GET /message_template_library`), but it returns an empty result
 * set on real (non-demo) WABAs — confirmed against production even
 * with Meta's own exact documented request. WhatsApp Manager's own
 * "Explore Meta Templates" browsing screen almost certainly isn't
 * built on that public endpoint either; it's most likely backed by an
 * internal Meta API that isn't exposed to third-party developers.
 *
 * So instead of a live catalog fetch, this file is a small,
 * hand-verified seed of real entries (exact `name`, category, topic,
 * usecase, industry, and content) captured from WhatsApp Manager's UI
 * and Meta's own docs. The CREATE call itself
 * (`POST /<WABA_ID>/message_templates` with `library_template_name`)
 * is fully documented and does work — sending an unverified/guessed
 * name is what produces Meta's "(#100) Invalid parameter" error, so
 * every entry here must be a name confirmed to exist, not a guess.
 *
 * Growing this list: open a template in WhatsApp Manager's own
 * Template Library, note the exact name shown in the breadcrumb under
 * the template title (e.g. "Utility · Order management ·
 * delivery_confirmation_3" → name is `delivery_confirmation_3`), and
 * add an entry below with its header/body/footer/buttons.
 */

export interface CatalogButton {
  type: 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY' | 'OTP' | 'FLOW'
  text: string
  /** URL buttons only — the example/default URL shown in WhatsApp Manager. */
  url?: string
  /** PHONE_NUMBER buttons only. */
  phoneNumber?: string
}

export interface TemplateLibraryCatalogEntry {
  name: string
  category: 'UTILITY' | 'AUTHENTICATION'
  topic: string
  usecase: string
  industry: string
  language: string
  header?: string
  body: string
  footer?: string
  buttons?: CatalogButton[]
}

export const TEMPLATE_LIBRARY_CATALOG: TemplateLibraryCatalogEntry[] = [
  {
    name: 'account_creation_confirmation_3',
    category: 'UTILITY',
    topic: 'ACCOUNT_UPDATE',
    usecase: 'ACCOUNT_CREATION_CONFIRMATION',
    industry: 'FINANCIAL_SERVICES',
    language: 'en_US',
    header: 'Finalize account set-up',
    body: 'Hi {{1}},\n\nYour new account has been created successfully.\n\nPlease verify {{2}} to complete your profile.',
    buttons: [{ type: 'URL', text: 'Verify account', url: 'https://www.example.com' }],
  },
  {
    name: 'delivery_confirmation_3',
    category: 'UTILITY',
    topic: 'ORDER_MANAGEMENT',
    usecase: 'DELIVERY_CONFIRMATION',
    industry: 'E_COMMERCE',
    language: 'en_US',
    body: 'Your package was delivered to {{1}} on {{2}}. Thank you for your business.',
    buttons: [{ type: 'URL', text: 'View order details', url: 'https://www.example.com' }],
  },
  {
    name: 'delivery_failed_2_form',
    category: 'UTILITY',
    topic: 'ORDER_MANAGEMENT',
    usecase: 'DELIVERY_FAILED',
    industry: 'E_COMMERCE',
    language: 'en_US',
    body: 'We were unable to deliver order {{1}} today.\n\nPlease {{2}} to schedule another delivery attempt.',
    buttons: [{ type: 'FLOW', text: 'Reschedule' }],
  },
  {
    name: 'low_balance_warning_1',
    category: 'UTILITY',
    topic: 'PAYMENTS',
    usecase: 'LOW_BALANCE_WARNING',
    industry: 'FINANCIAL_SERVICES',
    language: 'en_US',
    header: 'Your account balance is low',
    body: 'Hi {{1}}, this is to notify you that your {{2}} in your {{3}} account, ending in {{4}}, is below {{5}}. {{6}}.\n\nClick the button to deposit more {{7}}.\n\n{{8}}',
    buttons: [
      { type: 'URL', text: 'Make a deposit', url: 'https://www.example.com' },
      { type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '+18005551234' },
    ],
  },
]
