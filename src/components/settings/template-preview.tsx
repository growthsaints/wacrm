'use client';

import { FileText, Image as ImageIcon, Phone, Reply, SquareArrowOutUpRight, Video } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TemplateButton } from '@/types';

interface CardPreviewInput {
  header_format: 'image' | 'video';
  header_media_url: string;
  body_text: string;
  body_samples: string[];
  buttons: TemplateButton[];
}

export interface TemplatePreviewInput {
  header_format: 'none' | 'text' | 'image' | 'video' | 'document';
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
  cards: CardPreviewInput[];
}

/** Replaces `{{1}}`, `{{2}}`, ... with the matching sample value, or a
 * muted placeholder when no sample was entered yet — mirrors what
 * Meta's own reviewer/approval preview shows. */
function renderWithSamples(text: string, samples: string[]): (string | { placeholder: string })[] {
  if (!text) return [];
  const parts = text.split(/(\{\{\d+\}\})/g);
  return parts.map((part) => {
    const match = part.match(/^\{\{(\d+)\}\}$/);
    if (!match) return part;
    const idx = Number(match[1]) - 1;
    const value = samples[idx]?.trim();
    return value ? value : { placeholder: `Sample ${match[1]}` };
  });
}

function Substituted({ text, samples }: { text: string; samples: string[] }) {
  return (
    <>
      {renderWithSamples(text, samples).map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <span key={i} className="italic text-muted-foreground/70">
            {part.placeholder}
          </span>
        ),
      )}
    </>
  );
}

function ButtonRow({ button }: { button: TemplateButton }) {
  const icon =
    button.type === 'URL' ? (
      <SquareArrowOutUpRight className="size-3.5" />
    ) : button.type === 'PHONE_NUMBER' ? (
      <Phone className="size-3.5" />
    ) : button.type === 'COPY_CODE' ? (
      <FileText className="size-3.5" />
    ) : (
      <Reply className="size-3.5" />
    );
  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-black/10 py-2 text-[13px] font-medium text-sky-600 dark:border-white/10 dark:text-sky-400">
      {icon}
      <span className="truncate">{button.text || '(button text)'}</span>
    </div>
  );
}

function HeaderMedia({
  format,
  mediaUrl,
}: {
  format: 'image' | 'video' | 'document';
  mediaUrl: string;
}) {
  if (format === 'image' && mediaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={mediaUrl} alt="" className="h-36 w-full rounded-t-lg object-cover" />
    );
  }
  const Icon = format === 'video' ? Video : format === 'document' ? FileText : ImageIcon;
  return (
    <div className="flex h-36 w-full items-center justify-center rounded-t-lg bg-black/10 dark:bg-white/10">
      <Icon className="size-8 text-muted-foreground" />
    </div>
  );
}

/**
 * WhatsApp-bubble-style live preview, driven directly off the same
 * form state the editor is filling in — no server round-trip, updates
 * on every keystroke. This is a rendering approximation (Meta's own
 * client is the source of truth for exact spacing/behavior) meant to
 * catch obvious mistakes — a variable that never got a sample, a body
 * that reads oddly with real values — before submitting to Meta.
 */
export function TemplatePreview({ form }: { form: TemplatePreviewInput }) {
  const t = useTranslations('Settings.templates');
  const isCarousel = form.cards.length > 0;
  const firstCard = form.cards[0];

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('previewLabel')}
      </p>
      <div className="rounded-lg bg-[#e5ded8] p-3 dark:bg-[#0b141a]">
        <div className="overflow-hidden rounded-lg bg-white text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
          {isCarousel && firstCard ? (
            <HeaderMedia format={firstCard.header_format} mediaUrl={firstCard.header_media_url} />
          ) : form.header_format === 'image' || form.header_format === 'video' || form.header_format === 'document' ? (
            <HeaderMedia format={form.header_format} mediaUrl={form.header_media_url} />
          ) : null}

          <div className="space-y-1.5 px-3 py-2.5">
            {!isCarousel && form.header_format === 'text' && form.header_content && (
              <p className="text-[14px] font-bold leading-snug">
                <Substituted text={form.header_content} samples={[form.header_sample]} />
              </p>
            )}

            <p className="whitespace-pre-wrap text-[14px] leading-snug">
              <Substituted
                text={isCarousel && firstCard ? firstCard.body_text : form.body_text}
                samples={isCarousel && firstCard ? firstCard.body_samples : form.body_samples}
              />
              {!isCarousel && !form.body_text && (
                <span className="italic text-muted-foreground/70">{t('previewEmptyBody')}</span>
              )}
            </p>

            {!isCarousel && form.footer_text && (
              <p className="text-[12px] text-muted-foreground">{form.footer_text}</p>
            )}

            <p className="pt-0.5 text-right text-[11px] text-muted-foreground">12:00 PM</p>
          </div>

          {(isCarousel && firstCard ? firstCard.buttons : form.buttons).map((btn, i) => (
            <ButtonRow key={i} button={btn} />
          ))}
        </div>

        {isCarousel && (
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            {t('previewCarouselNote', { count: form.cards.length })}
          </p>
        )}
      </div>
    </div>
  );
}
