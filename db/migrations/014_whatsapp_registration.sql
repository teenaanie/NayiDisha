-- WhatsApp self-registration.
--
-- Operations sends an invite; a candidate who says yes fills one WhatsApp form
-- (a Meta "Flow" in production, the simulator's sheet in the demo) and is
-- registered without ever visiting the site. They then sign in with mobile +
-- OTP to finish what matching still needs.
--
-- The form collects more than the conversational journey does, so the
-- candidate row gains the columns to hold it. A registered candidate sits in
-- the existing PROFILE_INCOMPLETE status: details captured, but the matching
-- gates (locality, role, declarations) are not yet all met.

ALTER TABLE app.candidate
  ADD COLUMN email                 TEXT,
  ADD COLUMN pin_code              TEXT CHECK (pin_code IS NULL OR pin_code ~ '^[1-9][0-9]{5}$'),
  ADD COLUMN date_of_birth         DATE,
  ADD COLUMN gender                TEXT CHECK (gender IS NULL OR gender IN ('FEMALE','MALE','OTHER','UNDISCLOSED')),
  ADD COLUMN highest_qualification TEXT,
  ADD COLUMN current_industry      TEXT,
  ADD COLUMN current_job_role      TEXT,
  ADD COLUMN current_company       TEXT,
  ADD COLUMN registration_channel  TEXT;

-- Resumes live in object storage; the row holds only the key. Replacing a
-- resume adds a row, so the history of what an employer might have seen stays.
CREATE TABLE app.candidate_resume (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES app.candidate(id),
  object_key   TEXT,
  storage      TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304),
  source       TEXT NOT NULL CHECK (source IN ('WHATSAPP','WEB')),
  uploaded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_candidate_resume_candidate ON app.candidate_resume(candidate_id, uploaded_at DESC);

CREATE TABLE app.whatsapp_invite (
  id           TEXT PRIMARY KEY,
  phone        TEXT NOT NULL,
  -- Unguessable handle for the simulator's chat thread. In production the
  -- thread is the phone number itself, authenticated by WhatsApp.
  token        TEXT NOT NULL UNIQUE,
  sent_by      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('SENT','ACCEPTED','DECLINED','FORM_SUBMITTED','EXPIRED')),
  language     TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','mr')),
  candidate_id TEXT REFERENCES app.candidate(id),
  sent_at      TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ
);
CREATE INDEX idx_whatsapp_invite_phone ON app.whatsapp_invite(phone, sent_at DESC);

-- An invite is sent before any candidate row exists, so its messages cannot
-- hang off candidate_id alone.
ALTER TABLE app.message_log ADD COLUMN invite_id TEXT REFERENCES app.whatsapp_invite(id);

-- Pin code to locality, so a form answer can land in the matching engine's
-- locality without asking twice. Not a foreign key: the locality catalogue is
-- demo seed data and is rebuilt after migrations on a reset.
CREATE TABLE app.pin_code (
  pin_code     TEXT PRIMARY KEY,
  locality_key TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT 'Pune'
);
INSERT INTO app.pin_code (pin_code, locality_key) VALUES
  ('411005','shivajinagar'), ('411016','shivajinagar'),
  ('411038','kothrud'), ('411029','kothrud'),
  ('411014','viman_nagar'), ('411032','viman_nagar'),
  ('411028','hadapsar'), ('411013','hadapsar'),
  ('411018','pimpri'), ('411017','pimpri'),
  ('411045','baner'),
  ('411007','aundh'), ('411027','aundh'),
  ('411004','deccan')
ON CONFLICT (pin_code) DO NOTHING;

INSERT INTO app.message_template (key, language, category, body, buttons) VALUES
  ('job_invite','en','MARKETING','Namaste! Would you like to explore job opportunities near you through NayiDisha? It is free for job seekers.','["Yes, show me","No, thanks"]'),
  ('job_invite','hi','MARKETING','नमस्ते! क्या आप NayiDisha के ज़रिए अपने आस-पास नौकरी के अवसर देखना चाहेंगे? नौकरी ढूँढने वालों के लिए यह मुफ़्त है।','["हाँ, दिखाइए","नहीं, धन्यवाद"]'),
  ('job_invite','mr','MARKETING','नमस्कार! NayiDisha द्वारे तुमच्या जवळच्या नोकरीच्या संधी पाहायच्या आहेत का? नोकरी शोधणाऱ्यांसाठी हे मोफत आहे.','["हो, दाखवा","नको, धन्यवाद"]'),
  ('registration_form','en','SERVICE','Great! Tap below to share your details and resume. It takes about 3 minutes.','["Open form"]'),
  ('registration_form','hi','SERVICE','बढ़िया! अपनी जानकारी और रिज़्यूमे भेजने के लिए नीचे टैप करें। लगभग 3 मिनट लगेंगे।','["फ़ॉर्म खोलें"]'),
  ('registration_form','mr','SERVICE','छान! तुमची माहिती आणि रिझ्युमे पाठवण्यासाठी खाली टॅप करा. साधारण ३ मिनिटे लागतील.','["फॉर्म उघडा"]'),
  ('registration_link','en','UTILITY','Thank you, {{name}}. You are registered with NayiDisha. Sign in with your mobile number and OTP to complete your profile or browse jobs: {{link}}','[]'),
  ('registration_link','hi','UTILITY','धन्यवाद, {{name}}। आप NayiDisha पर रजिस्टर हो गए हैं। प्रोफ़ाइल पूरी करने या नौकरियाँ देखने के लिए मोबाइल नंबर और OTP से साइन इन करें: {{link}}','[]'),
  ('registration_link','mr','UTILITY','धन्यवाद, {{name}}. तुमची NayiDisha वर नोंदणी झाली आहे. प्रोफाइल पूर्ण करण्यासाठी किंवा नोकऱ्या पाहण्यासाठी मोबाइल नंबर आणि OTP ने साइन इन करा: {{link}}','[]'),
  ('invite_declined','en','SERVICE','No problem. Reply HI any time if you change your mind.','[]'),
  ('invite_declined','hi','SERVICE','कोई बात नहीं। मन बदले तो कभी भी HI लिखकर भेजें।','[]'),
  ('invite_declined','mr','SERVICE','हरकत नाही. विचार बदलला तर कधीही HI पाठवा.','[]')
ON CONFLICT (key, language) DO NOTHING;

-- Fallback object store for deployments without Supabase Storage configured.
-- Resumes are capped at 4 MB, so a demo can keep them in Postgres; production
-- sets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and this table stays empty.
CREATE TABLE app.stored_object (
  key        TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
