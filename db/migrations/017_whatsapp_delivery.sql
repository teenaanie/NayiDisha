-- Real WhatsApp delivery, beneath the registration flow that already exists.
--
-- The simulator knew a message's fate when it wrote the row. Meta only tells
-- you it accepted one, then reports what actually happened minutes later over
-- a webhook. So a row needs somewhere to keep Meta's id — the only thing tying
-- a receipt back to the row it belongs to — and a status that can move after
-- the fact.

ALTER TABLE app.message_log ADD COLUMN provider_ref    TEXT;
ALTER TABLE app.message_log ADD COLUMN provider        TEXT;
ALTER TABLE app.message_log ADD COLUMN status_at       TIMESTAMPTZ;
-- What Meta says it billed, beside the cost we modelled. Comparing the two is
-- how the funnel's pricing assumptions get checked against reality.
ALTER TABLE app.message_log ADD COLUMN billed_category TEXT;

-- A receipt arrives keyed only by wamid, so this is the hot lookup. Partial,
-- because simulator rows never have one.
CREATE UNIQUE INDEX idx_message_log_provider_ref
  ON app.message_log(provider_ref) WHERE provider_ref IS NOT NULL;

-- Inbound from a number nobody recognises belongs to no candidate and no
-- invite yet. Keeping it means the journey can resolve who it was once they
-- register, and Operations has something to look at when it cannot.
CREATE TABLE app.inbound_message (
  id            TEXT PRIMARY KEY,
  provider_ref  TEXT UNIQUE,
  from_phone    TEXT NOT NULL,
  candidate_id  TEXT REFERENCES app.candidate(id),
  invite_id     TEXT REFERENCES app.whatsapp_invite(id),
  body          TEXT NOT NULL,
  message_type  TEXT NOT NULL DEFAULT 'text',
  raw           JSONB NOT NULL DEFAULT '{}',
  routed_to     TEXT,
  received_at   TIMESTAMPTZ NOT NULL,
  handled_at    TIMESTAMPTZ
);
CREATE INDEX idx_inbound_message_phone ON app.inbound_message(from_phone, received_at DESC);
CREATE INDEX idx_inbound_message_unhandled ON app.inbound_message(received_at) WHERE handled_at IS NULL;
