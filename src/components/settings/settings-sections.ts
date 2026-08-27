import {
  BellRing,
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  MessagesSquare,
  Palette,
  PlugZap,
  Shield,
  ShoppingBag,
  Tags,
  User,
  UsersRound,
  Wallet,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'sms',
  'httpsms',
  'templates',
  'quick-replies',
  'whatsapp-flows',
  'commerce',
  'notification-rules',
  'fields',
  'deals',
  'billing',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins;
 *  `ownerOnly` items are hidden for everyone but the owner (a stricter
 *  gate than `adminOnly` — billing/plan info isn't for team members
 *  at all, admins included). */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'channels' | 'workspace';
  adminOnly?: boolean;
  ownerOnly?: boolean;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'channels' },
  sms: { id: 'sms', label: 'SMS', icon: MessageSquare, group: 'channels' },
  httpsms: { id: 'httpsms', label: 'httpSMS', icon: MessagesSquare, group: 'channels' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace' },
  'whatsapp-flows': { id: 'whatsapp-flows', label: 'WhatsApp Flows', icon: Workflow, group: 'workspace' },
  commerce: { id: 'commerce', label: 'Commerce', icon: ShoppingBag, group: 'workspace' },
  'notification-rules': {
    id: 'notification-rules',
    label: 'Order & Payment Alerts',
    icon: BellRing,
    group: 'workspace',
    adminOnly: true,
  },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace' },
  billing: { id: 'billing', label: 'Billing', icon: Wallet, group: 'workspace', ownerOnly: true },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Channels', group: 'channels' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
