'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { SmsConfig } from '@/components/settings/sms-config';
import { HttpSmsConfig } from '@/components/settings/httpsms-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { WhatsAppFlowsManager } from '@/components/settings/whatsapp-flows-manager';
import { CommerceSettings } from '@/components/settings/commerce-settings';
import { NotificationRulesManager } from '@/components/settings/notification-rules-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { WalletBilling } from '@/components/settings/wallet-billing';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, canEditSettings, isOwner, canAccessTemplates, canAccessSms } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  // A non-admin deep-linking straight to an adminOnly section, a
  // non-owner deep-linking to an ownerOnly section (Billing), or an
  // ungranted agent deep-linking to Templates or SMS/httpSMS, falls
  // back to Overview rather than rendering it.
  const rawSection = resolveSection(searchParams.get('tab'));
  const blocked =
    (SECTION_META[rawSection].adminOnly && !canEditSettings) ||
    (SECTION_META[rawSection].ownerOnly && !isOwner) ||
    (rawSection === 'templates' && !canAccessTemplates) ||
    ((rawSection === 'sms' || rawSection === 'httpsms') && !canAccessSms);
  const section = blocked ? 'overview' : rawSection;

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    sms: <SmsConfig />,
    httpsms: <HttpSmsConfig />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    'whatsapp-flows': <WhatsAppFlowsManager />,
    commerce: <CommerceSettings />,
    'notification-rules': <NotificationRulesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    billing: <WalletBilling />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail
          active={section}
          onSelect={go}
          hints={hints}
          isAdmin={canEditSettings}
          isOwner={isOwner}
          canAccessTemplates={canAccessTemplates}
          canAccessSms={canAccessSms}
        />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
