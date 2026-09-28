-- Sales roleplay simulations.
--
-- A candidate plays a sales officer; an AI customer plays the prospect. Four
-- parts, kept apart on purpose (see doc/Education Loan Simulation Example):
--   scenario   — what the customer knows, when they may reveal it, the rubric
--   session    — one attempt, with the facts disclosed so far
--   turn       — the verbatim transcript, never overwritten
--   evaluation — produced by a separate evaluator that never plays the
--                customer, so the judge is not also the actor.
--
-- The scenario is versioned like role_script. An evaluation records the rubric
-- version and the evaluator that produced it: a score whose provenance cannot
-- be shown is not a score.

CREATE TABLE app.simulation_scenario (
  id               TEXT NOT NULL,
  version          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  title            TEXT NOT NULL,
  product          TEXT NOT NULL,
  skill            TEXT NOT NULL,
  difficulty       TEXT NOT NULL,
  duration_min     INT NOT NULL DEFAULT 12,
  max_turns        INT NOT NULL DEFAULT 30,
  learner_role     TEXT NOT NULL,
  -- {en,hi,mr}: what the learner is told before starting.
  learner_brief    JSONB NOT NULL,
  -- {lang: text}: the customer's first line.
  opening_line     JSONB NOT NULL,
  customer_profile JSONB NOT NULL,
  -- [{key,label,value,reveal_when,reply:{en,hi,mr},keywords:[..]}]
  facts            JSONB NOT NULL,
  -- {en,hi,mr}: said when the learner pitches before understanding the need.
  pitch_deflection JSONB NOT NULL,
  -- [{key,label,excellent,acceptable,poor,evidence_keys:[..]}], each dimension 1-5.
  rubric           JSONB NOT NULL,
  -- [{key,label,patterns:[regex..]}] — learner statements that are compliance risks.
  risk_rules       JSONB NOT NULL,
  -- [{min,label}] in descending order of min.
  bands            JSONB NOT NULL,
  -- Role families this practice is relevant to (not an FK; catalogue may move).
  role_family_keys JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE TABLE app.simulation_session (
  id               TEXT PRIMARY KEY,
  candidate_id     TEXT NOT NULL REFERENCES app.candidate(id),
  scenario_id      TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  -- Sarvam's language set, wider than the candidate profile's en/hi/mr.
  language         TEXT NOT NULL CHECK (language IN ('en','hi','mr','ta','te','kn','bn','gu','ml','pa','od')),
  status           TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','ABANDONED','TIMED_OUT')),
  turn_count       INT NOT NULL DEFAULT 0,
  -- Fact keys the customer has disclosed, and to which learner turn.
  revealed         JSONB NOT NULL DEFAULT '{}',
  pitched_early    BOOLEAN NOT NULL DEFAULT FALSE,
  retry_of         TEXT REFERENCES app.simulation_session(id),
  retry_focus      TEXT,
  customer_agent   TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ,
  FOREIGN KEY (scenario_id, scenario_version) REFERENCES app.simulation_scenario(id, version)
);
CREATE INDEX idx_simulation_session_candidate ON app.simulation_session(candidate_id, started_at DESC);

CREATE TABLE app.simulation_turn (
  session_id     TEXT NOT NULL REFERENCES app.simulation_session(id),
  seq            INT NOT NULL,
  speaker        TEXT NOT NULL CHECK (speaker IN ('LEARNER','CUSTOMER')),
  -- What was actually said. Never overwritten.
  text           TEXT NOT NULL,
  -- English rendering the evaluator reads, so one rubric scores every language.
  text_en        TEXT,
  input_mode     TEXT NOT NULL DEFAULT 'TEXT' CHECK (input_mode IN ('TEXT','VOICE')),
  stt_confidence NUMERIC(3,2),
  revealed_keys  JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE app.simulation_evaluation (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL UNIQUE REFERENCES app.simulation_session(id),
  rubric_version     TEXT NOT NULL,
  evaluator          TEXT NOT NULL,
  overall            INT NOT NULL,
  max_score          INT NOT NULL,
  band               TEXT NOT NULL,
  dimension_scores   JSONB NOT NULL,
  coverage           JSONB NOT NULL,
  risk_flags         JSONB NOT NULL DEFAULT '[]',
  strengths          JSONB NOT NULL DEFAULT '[]',
  improvements       JSONB NOT NULL DEFAULT '[]',
  best_moment        TEXT,
  missed_opportunity TEXT,
  retry              JSONB NOT NULL DEFAULT '{}',
  confidence         NUMERIC(3,2) NOT NULL DEFAULT 0,
  needs_review       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL
);

-- Voice practice sends audio to a speech provider, unlike the browser-only
-- voice journey. That is a new purpose and needs its own consent.
ALTER TABLE app.consent_record DROP CONSTRAINT consent_record_purpose_check;
ALTER TABLE app.consent_record ADD CONSTRAINT consent_record_purpose_check
  CHECK (purpose IN ('PROCESSING','PARTNER_ASSISTANCE','JOB_ALERTS','DOCUMENTS','PRECISE_LOCATION','VOICE_SCREENING','SIMULATION_VOICE'));

-- The scenario is reference content, so it ships with the schema rather than
-- with the demo seed: migrating an existing database is enough to use it.
INSERT INTO app.simulation_scenario (
  id, version, title, product, skill, difficulty, duration_min, max_turns, learner_role,
  learner_brief, opening_line, customer_profile, facts, pitch_deflection, rubric, risk_rules, bands, role_family_keys
) VALUES (
  'EDU_DISCOVERY_001', '1.0',
  'Education Loan Discovery: Understanding the Student''s Funding Need',
  'Education Loan', 'Discovery Questions', 'Intermediate', 12, 30,
  'Education Loan Sales Officer',
  '{"en":"You are speaking with Mr. Sharma, whose daughter has received admission for a postgraduate course. He wants to understand whether an education loan is suitable. Your goal is not to sell immediately. Ask the right discovery questions and understand the student''s education plan, funding gap, repayment comfort and decision concerns.",
    "hi":"आप श्री शर्मा से बात कर रहे हैं, जिनकी बेटी को एक पोस्टग्रेजुएट कोर्स में दाखिला मिला है। वे समझना चाहते हैं कि क्या एजुकेशन लोन उनके लिए सही है। आपका लक्ष्य तुरंत बेचना नहीं है। सही सवाल पूछें और छात्रा की पढ़ाई की योजना, फंडिंग की कमी, EMI चुकाने की सहजता और उनकी चिंताओं को समझें।",
    "mr":"तुम्ही श्री. शर्मा यांच्याशी बोलत आहात. त्यांच्या मुलीला पदव्युत्तर अभ्यासक्रमात प्रवेश मिळाला आहे. एज्युकेशन लोन योग्य आहे का हे त्यांना समजून घ्यायचे आहे. लगेच विक्री करणे हे तुमचे ध्येय नाही. योग्य प्रश्न विचारा आणि विद्यार्थिनीची शिक्षण योजना, निधीतील तूट, परतफेडीची सोय आणि त्यांच्या चिंता समजून घ्या."}',
  '{"en":"Hello, my daughter has got admission for an MBA, and someone told me I can take an education loan. I just want to know how much loan we can get.",
    "hi":"नमस्ते, मेरी बेटी को MBA में एडमिशन मिला है, और किसी ने बताया कि एजुकेशन लोन ले सकते हैं। मुझे बस इतना जानना है कि हमें कितना लोन मिल सकता है।",
    "mr":"नमस्कार, माझ्या मुलीला MBA ला प्रवेश मिळाला आहे, आणि कोणीतरी सांगितलं की एज्युकेशन लोन घेता येतं. आम्हाला किती लोन मिळू शकतं एवढंच मला जाणून घ्यायचं आहे."}',
  '{"name":"Rajesh Sharma","relationship":"Father of student","student":"Riya Sharma","course":"MBA","institution":"Private university in India","total_cost":"₹14 lakh","savings":"₹4 lakh","scholarship":"Applied, not confirmed","fee_deadline":"First fee payment due in 3 weeks","main_concern":"EMI burden after course completion","hidden_concern":"Unsure whether to use family savings or take a loan","initial_mood":"Polite but cautious"}',
  '[
    {"key":"course","good_question":"Which course has your daughter received admission for?","label":"Student name and course","value":"Riya Sharma, MBA","reveal_when":"The learner asks which course, what the student is studying, or the student''s name.","keywords":["course","programme","program","mba","study","studying","student","daughter''s name","कोर्स","पढ़","अभ्यासक्रम"],
     "reply":{"en":"My daughter Riya is doing an MBA, a two-year full-time course.","hi":"मेरी बेटी रिया MBA कर रही है, दो साल का फुल-टाइम कोर्स।","mr":"माझी मुलगी रिया MBA करत आहे, दोन वर्षांचा पूर्णवेळ अभ्यासक्रम."}},
    {"key":"institution","good_question":"Which institution is it, and where will she be studying?","label":"Institution and study location","value":"A private university in India","reveal_when":"The learner asks which institution, college or university, or where she will study.","keywords":["institution","college","university","institute","where","location","city","कॉलेज","यूनिवर्सिटी","संस्था","कुठे","कहाँ"],
     "reply":{"en":"It is a private university here in India, not abroad.","hi":"यह भारत की ही एक प्राइवेट यूनिवर्सिटी है, विदेश नहीं।","mr":"हे भारतातीलच एक खाजगी विद्यापीठ आहे, परदेशात नाही."}},
    {"key":"admission","good_question":"Has the admission been confirmed, or is it still in process?","label":"Admission status","value":"Admission confirmed","reveal_when":"The learner asks whether admission is confirmed or still in process.","keywords":["admission","confirmed","offer letter","admit","एडमिशन","प्रवेश","निश्चित"],
     "reply":{"en":"Yes, the admission is confirmed. We have the offer letter.","hi":"हाँ, एडमिशन पक्का है। ऑफर लेटर आ गया है।","mr":"हो, प्रवेश निश्चित झाला आहे. ऑफर लेटर आलं आहे."}},
    {"key":"total_cost","good_question":"What is the total estimated cost, including tuition, hostel, books, laptop and other approved expenses?","label":"Total cost of education","value":"About ₹14 lakh including fees and other costs","reveal_when":"The learner asks about the total cost, fees, tuition, hostel, books or other expenses.","keywords":["cost","fee","fees","tuition","hostel","books","laptop","expense","total","खर्च","फीस","शुल्क","एकूण","कुल"],
     "reply":{"en":"The whole course is around ₹14 lakh, including tuition and hostel.","hi":"पूरा कोर्स लगभग 14 लाख का है, ट्यूशन और हॉस्टल मिलाकर।","mr":"पूर्ण अभ्यासक्रम सुमारे १४ लाखांचा आहे, ट्यूशन आणि हॉस्टेल धरून."}},
    {"key":"deadline","good_question":"When is the first fee payment due?","label":"Fee payment deadline","value":"First payment due in about three weeks","reveal_when":"The learner asks when the fee is due, the deadline or timeline.","keywords":["when","deadline","due","date","timeline","by when","कब","तारीख","अंतिम","कधी","मुदत"],
     "reply":{"en":"The first payment is due in about three weeks.","hi":"पहली किस्त लगभग तीन हफ्ते में भरनी है।","mr":"पहिला हप्ता साधारण तीन आठवड्यांत भरायचा आहे."}},
    {"key":"savings","good_question":"How much can your family contribute comfortably without affecting emergency savings?","label":"Family contribution","value":"Can arrange about ₹4 lakh, but not keen to use everything","reveal_when":"The learner asks about savings, family contribution or how much the family can arrange.","keywords":["savings","save","contribute","contribution","arrange","own funds","family","बचत","जमा","इंतज़ाम","योगदान","बचत","स्वतः"],
     "reply":{"en":"We can arrange around ₹4 lakh, but I do not want to use everything.","hi":"हम लगभग 4 लाख का इंतज़ाम कर सकते हैं, पर सारी बचत नहीं लगाना चाहता।","mr":"आम्ही सुमारे ४ लाख उभे करू शकतो, पण सगळी बचत वापरायची नाही."}},
    {"key":"scholarship","good_question":"Has any scholarship, assistantship or other funding been confirmed?","label":"Scholarship or other funding","value":"Applied for a scholarship; result not known","reveal_when":"The learner asks about scholarship, assistantship or other funding.","keywords":["scholarship","assistantship","grant","other funding","financial aid","स्कॉलरशिप","छात्रवृत्ति","शिष्यवृत्ती"],
     "reply":{"en":"She has applied for one, but we do not know the result yet.","hi":"उसने एक स्कॉलरशिप के लिए आवेदन किया है, पर अभी नतीजा नहीं आया।","mr":"तिने एका शिष्यवृत्तीसाठी अर्ज केला आहे, पण अजून निकाल आलेला नाही."}},
    {"key":"co_borrower","good_question":"Who will be the co-borrower for the loan?","label":"Co-borrower and income","value":"Rajesh, salaried, would be the co-borrower","reveal_when":"The learner asks who the co-borrower would be or about the parent''s income or job.","keywords":["co-borrower","coborrower","co borrower","guarantor","income","salary","earn","occupation","job","सह-उधारकर्ता","आय","आमदनी","नौकरी","उत्पन्न","पगार"],
     "reply":{"en":"I would be the co-borrower. I am salaried, working in a private company.","hi":"मैं को-बॉरोअर बनूँगा। मैं एक प्राइवेट कंपनी में नौकरी करता हूँ।","mr":"मी सह-कर्जदार असेन. मी एका खाजगी कंपनीत नोकरी करतो."}},
    {"key":"repayment_concern","good_question":"What monthly repayment range would feel manageable after the course?","label":"Repayment comfort and EMI concern","value":"Worried about a heavy EMI later","reveal_when":"The learner asks about repayment, EMI comfort or what monthly amount feels manageable.","keywords":["repay","repayment","emi","monthly","manageable","comfortable","afford","installment","instalment","किस्त","चुकाना","परतफेड","हप्ता"],
     "reply":{"en":"That is what worries me. I do not want a very heavy EMI later.","hi":"यही तो मेरी चिंता है। बाद में बहुत भारी EMI नहीं चाहिए।","mr":"हीच तर माझी काळजी आहे. नंतर खूप मोठा EMI नको."}},
    {"key":"savings_vs_loan","good_question":"What is your biggest worry in deciding between using savings and taking a loan?","label":"Hidden concern: savings versus loan","value":"Unsure whether to use family savings or take a loan","reveal_when":"The learner explores his worries, how he feels about using savings, or what would make the decision easier.","keywords":["worry","worried","concern","hesitat","savings or","savings versus","use your savings","use savings","emergency","decision","चिंता","फ़ैसला","निर्णय","काळजी"],
     "reply":{"en":"Honestly, I am not sure whether to use our savings or take a loan. Those savings are for emergencies.","hi":"सच कहूँ तो समझ नहीं आ रहा कि बचत लगाएँ या लोन लें। वह बचत मुसीबत के लिए रखी है।","mr":"खरं सांगायचं तर बचत वापरावी की कर्ज घ्यावं हे कळत नाही. ती बचत अडचणीच्या वेळेसाठी आहे."}},
    {"key":"moratorium","good_question":"Would you like me to explain when repayment may start and how moratorium works?","label":"Understanding of moratorium","value":"Does not know when repayment would start","reveal_when":"The learner asks whether he knows when repayment starts, or explains moratorium and checks his understanding.","keywords":["moratorium","repayment start","repayment begin","grace period","when repayment","when does repayment","when will repayment","holiday period","मोरेटोरियम","किस्त कब शुरू","अधिस्थगन","परतफेड कधी"],
     "reply":{"en":"I did not know that. So repayment starts only after the course? Please explain.","hi":"यह मुझे नहीं पता था। तो किस्त कोर्स के बाद शुरू होगी? समझाइए।","mr":"हे मला माहीत नव्हतं. म्हणजे परतफेड अभ्यासक्रमानंतर सुरू होते? समजावून सांगा."}}
  ]',
  '{"en":"But before that, I want to understand whether this will become too much burden for us.","hi":"पर उससे पहले मैं समझना चाहता हूँ कि कहीं यह हम पर बहुत बोझ तो नहीं बन जाएगा।","mr":"पण त्याआधी मला हे समजून घ्यायचं आहे की याचा आमच्यावर खूप भार तर पडणार नाही ना."}',
  '[
    {"key":"course_admission","label":"Course and admission discovery","excellent":"Clearly asks course, institution, admission status, study location","acceptable":"Asks course but misses some key details","poor":"Does not understand education plan","evidence_keys":["course","institution","admission"]},
    {"key":"cost_gap","label":"Cost and funding gap discovery","excellent":"Explores total cost, savings, scholarship, deadline and funding gap","acceptable":"Asks basic loan amount but misses some funding details","poor":"Does not calculate or understand funding need","evidence_keys":["total_cost","savings","scholarship","deadline"]},
    {"key":"repayment","label":"Repayment comfort","excellent":"Explores co-borrower, EMI concern, moratorium and repayment expectations","acceptable":"Mentions repayment but does not explore comfort deeply","poor":"Ignores repayment concern","evidence_keys":["co_borrower","repayment_concern","moratorium","savings_vs_loan"]},
    {"key":"sequencing","label":"Listening and sequencing","excellent":"Asks logical follow-up questions before pitching","acceptable":"Mixes questions and product explanation","poor":"Gives product pitch too early","evidence_keys":[]},
    {"key":"responsible","label":"Responsible selling","excellent":"Avoids guarantees, clarifies that approval depends on assessment","acceptable":"Mostly compliant but slightly overstates certainty","poor":"Promises approval or loan amount","evidence_keys":[]},
    {"key":"clarity","label":"Communication clarity","excellent":"Uses simple language and checks understanding","acceptable":"Mostly clear but uses some jargon","poor":"Confusing or overly technical","evidence_keys":[]}
  ]',
  '[
    {"key":"guaranteed_approval","label":"Promises approval","patterns":["definitely (be )?approv","guarantee","100 ?%","sure(ly)? (get|be) approv","will (surely|definitely|certainly) get","pakka","पक्का","गारंटी","ज़रूर मिल","नक्की मिळ","हमखास"]},
    {"key":"promised_amount","label":"Promises a loan amount","patterns":["you will get (rs\\.?|₹|inr)? ?\\d","we will (give|sanction) (you )?(rs\\.?|₹)? ?\\d","full (amount|14 lakh) (is )?(sure|confirmed)"]},
    {"key":"dismiss_documents","label":"Dismisses documentation","patterns":["don.?t worry about (the )?documents","no documents? (needed|required)","documents (are )?not (needed|required|important)","कागज़ात की चिंता मत","कागदपत्रांची काळजी करू नका"]},
    {"key":"optional_compulsory","label":"Presents optional product as compulsory","patterns":["insurance is (compulsory|mandatory)","must (take|buy) (the )?insurance","(compulsory|mandatory) (insurance|cover)"]},
    {"key":"misstate_income","label":"Suggests misstating income","patterns":["increase (your )?income","show (more|higher) income","inflate","income (thoda )?badha"]}
  ]',
  '[{"min":25,"label":"Strong discovery"},{"min":19,"label":"Good, but needs sharper follow-up"},{"min":13,"label":"Basic discovery, important gaps"},{"min":0,"label":"Needs guided practice"}]',
  '["RELATIONSHIP_EXECUTIVE"]'
);

-- The candidate's best practice band, readable by matching and employers
-- through the same typed attribute store as every other role detail.
INSERT INTO app.attribute_definition (key, scope, data_type, display_name, allowed_values, created_at)
VALUES ('sales_roleplay_band','CANDIDATE_ROLE','TEXT','Sales practice result','[]',CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
