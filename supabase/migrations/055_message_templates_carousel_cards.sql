-- ============================================================
-- message_templates: carousel cards
--
-- Adds support for Meta's Carousel template format — a main BODY
-- plus a CAROUSEL component holding 2-10 "cards", each with its own
-- IMAGE/VIDEO header, body text, and up to 2 buttons.
-- https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/carousel-templates
--
-- Stored as a single JSONB array (not a child table) because a card's
-- shape mirrors the template row itself (header + body + buttons) and
-- is always read/written as a whole with its parent template — no
-- query ever needs a single card in isolation. Per-element validation
-- (2-10 cards, consistent header format across cards, button-shape
-- rules) lives in src/lib/whatsapp/template-validators.ts for the same
-- reason the existing `buttons` column keeps only a shape guard here.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS cards JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_cards_shape_check'
      AND conrelid = 'message_templates'::regclass
  ) THEN
    ALTER TABLE message_templates
      ADD CONSTRAINT message_templates_cards_shape_check
      CHECK (
        cards IS NULL
        OR (
          jsonb_typeof(cards) = 'array'
          AND jsonb_array_length(cards) BETWEEN 2 AND 10
        )
      );
  END IF;
END $$;
