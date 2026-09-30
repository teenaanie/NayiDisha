-- 019: token and cost meter. One row per call to a paid AI provider, written by
-- src/modules/ai-usage and read by /ops/ai-usage. Cost is not stored: it is
-- worked out from the price list when the page is read, so correcting a price
-- re-prices history instead of leaving old rows wrong.
CREATE TABLE IF NOT EXISTS app.ai_usage (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider      TEXT NOT NULL,              -- anthropic | gemini | sarvam | openai_compatible
  model         TEXT NOT NULL,
  feature       TEXT NOT NULL,              -- what the call was for, e.g. practice.customer
  input_tokens  INTEGER NOT NULL DEFAULT 0, -- uncached prompt tokens
  cached_tokens INTEGER NOT NULL DEFAULT 0, -- prompt tokens served from a cache
  output_tokens INTEGER NOT NULL DEFAULT 0, -- includes reasoning/thinking tokens
  characters    INTEGER NOT NULL DEFAULT 0, -- translation and text-to-speech bill by character
  audio_seconds NUMERIC(10, 2),             -- speech-to-text; null when the length could not be read
  ok            BOOLEAN NOT NULL DEFAULT true,
  latency_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON app.ai_usage (at DESC);
