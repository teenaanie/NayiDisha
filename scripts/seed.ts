/**
 * Canonical dummy dataset (§22).
 *
 * Reference data is inserted declaratively. Everything transactional —
 * applications, match results, unlocks, credit and reward ledger entries,
 * the replacement case and its reversal — is produced by calling the real
 * domain services, so a demo reset reproduces §22's outcomes through the same
 * code paths the demo will exercise live. That is what makes the §25 criterion
 * "demo reset restores all IDs and expected outcomes" mean something.
 *
 * All identities are fictional and prefixed DEMO. Phone numbers are
 * non-routable. Nothing here may be sent to a live provider.
 */
import { sql } from '../src/lib/db';
import { SEED_INSTANT, addDays, addHours } from '../src/lib/clock';
import { rupees } from '../src/lib/money';
import {
  startRegistration, verifyAndBind, grantConsent, completeProfile,
  seedAssessmentScore, inviteEndorsement, verifyEndorsement,
  applyAndEvaluate, withdrawConsent,
} from '../src/modules/candidate';
import {
  unlockQualifiedProfile, raiseReplacement, decideReplacement,
  releaseMaturedHolds, buildPayoutBatch,
} from '../src/modules/commercial';

const T0 = SEED_INSTANT;
const j = (v: unknown) => sql.json(v as never);

async function main() {
  console.log('Seeding canonical dataset (§22) at', T0.toISOString());

  // --- demo clock -----------------------------------------------------------
  await sql`DELETE FROM app.demo_clock`;
  await sql`INSERT INTO app.demo_clock (id, now_at, reset_at) VALUES (1, ${T0}, ${T0})`;

  // --- commercial policy (§22.2) — every value versioned, none hardcoded -----
  await sql`
    INSERT INTO app.commercial_policy (
      id, version, posting_fee_paise, included_unlock_credits, additional_credit_paise,
      max_distinct_unlocks_per_job, partner_reward_paise, partner_reward_hold_hours,
      replacement_window_hours, attribution_window_days, partner_payout_minimum_paise,
      payout_cadence, credit_expiry_days, preview_batch_size, job_expiry_days, active, created_at
    ) VALUES (
      'COM-DEMO-001', '1.0', ${rupees(2500)}, 10, ${rupees(250)},
      100, ${rupees(75)}, 72, 72, 30, ${rupees(500)},
      'WEEKLY_FRIDAY', 90, 10, 30, TRUE, ${T0}
    )
  `;

  // --- Pune locality centroids (backs the seeded TravelTimeProvider) ---------
  const localities: [string, string, number, number][] = [
    ['shivajinagar', 'Shivajinagar', 18.5308, 73.8478],
    ['kothrud', 'Kothrud', 18.5074, 73.8077],
    ['viman_nagar', 'Viman Nagar', 18.5679, 73.9143],
    ['hadapsar', 'Hadapsar', 18.5089, 73.9260],
    ['pimpri', 'Pimpri', 18.6298, 73.7997],
    ['baner', 'Baner', 18.5590, 73.7868],
    ['aundh', 'Aundh', 18.5626, 73.8077],
    ['deccan', 'Deccan Gymkhana', 18.5164, 73.8416],
  ];
  for (const [key, name, lat, lng] of localities) {
    await sql`INSERT INTO app.locality (key, display_name, city, lat, lng)
              VALUES (${key}, ${name}, 'Pune', ${lat}, ${lng})`;
  }

  // --- industries and role families -----------------------------------------
  await sql`INSERT INTO app.industry (key, display_name, translations, created_at) VALUES
    ('BFSI',   'Banking & Financial Services', ${j({ mr: 'बँकिंग आणि वित्तीय सेवा', hi: 'बैंकिंग एवं वित्तीय सेवाएँ' })}, ${T0}),
    ('RETAIL', 'Retail',                       ${j({ mr: 'रिटेल', hi: 'रिटेल' })}, ${T0})`;

  await sql`INSERT INTO app.role_family (key, industry_key, display_name, transferable, created_at) VALUES
    ('RELATIONSHIP_EXECUTIVE',     'BFSI',   'Relationship Executive',     ${j(['FIELD_SALES','TELECOM_SALES','SALES'])}, ${T0}),
    ('CUSTOMER_SERVICE_ASSOCIATE', 'BFSI',   'Customer Service Associate', ${j(['CUSTOMER_SERVICE','RETAIL_SALES'])}, ${T0}),
    ('SALES_ASSOCIATE',            'RETAIL', 'Sales Associate',            ${j(['RETAIL_SALES','SALES','FIELD_SALES'])}, ${T0})`;

  // --- attribute definitions (CFG-02) ---------------------------------------
  const attrs: [string, string, string, string][] = [
    ['locality',          'CANDIDATE_COMMON', 'TEXT',        'Home locality'],
    ['experience_months', 'CANDIDATE_COMMON', 'INT',         'Total experience (months)'],
    ['expected_pay',      'CANDIDATE_COMMON', 'MONEY_PAISE', 'Expected monthly pay'],
    ['max_commute_min',   'CANDIDATE_COMMON', 'INT',         'Maximum one-way commute (minutes)'],
    ['languages',         'CANDIDATE_COMMON', 'MULTI_ENUM',  'Languages spoken'],
    ['shift_availability','CANDIDATE_COMMON', 'MULTI_ENUM',  'Shifts available for'],
    ['work_authorised',   'CANDIDATE_COMMON', 'BOOL',        'Authorised to work in India'],
    ['casa_familiarity',  'CANDIDATE_ROLE',   'ENUM',        'Familiarity with CASA products'],
    ['field_sales_comfort','CANDIDATE_ROLE',  'ENUM',        'Comfort with field sales targets'],
    ['two_wheeler',       'CANDIDATE_ROLE',   'BOOL',        'Owns a two-wheeler'],
    ['pos_billing',       'CANDIDATE_ROLE',   'BOOL',        'Has used POS/billing software'],
    ['fixed_pay',         'JOB',              'MONEY_PAISE', 'Fixed monthly pay'],
    ['variable_max',      'JOB',              'MONEY_PAISE', 'Maximum monthly variable'],
    ['shift',             'JOB',              'TEXT',        'Shift window'],
    ['weekly_off',        'JOB',              'TEXT',        'Weekly off'],
  ];
  for (const [key, scope, type, name] of attrs) {
    await sql`INSERT INTO app.attribute_definition (key, scope, data_type, display_name, created_at)
              VALUES (${key}, ${scope}, ${type}, ${name}, ${T0})`;
  }

  // --- assessment templates (TEST-01/02/02A) --------------------------------
  const bfsiQuestions = [
    { id: 'q1', section: 'Numeracy', marks: 20, prompt: 'A customer deposits ₹15,000 and withdraws ₹4,500. What is the net change?', options: ['₹10,500 increase', '₹19,500 increase', '₹10,500 decrease', '₹4,500 increase'], answer: '₹10,500 increase' },
    { id: 'q2', section: 'Customer communication', marks: 20, prompt: 'A customer is angry about a delayed passbook update. What do you do first?', options: ['Explain the bank policy', 'Listen fully, then acknowledge the delay', 'Direct them to the manager', 'Ask them to come back tomorrow'], answer: 'Listen fully, then acknowledge the delay' },
    { id: 'q3', section: 'Sales scenario', marks: 20, prompt: 'A customer says they already have an account elsewhere. The best response is to:', options: ['End the conversation', 'Ask what they find useful about it', 'Say our bank is better', 'Offer a discount immediately'], answer: 'Ask what they find useful about it' },
    { id: 'q4', section: 'Integrity', marks: 20, prompt: 'A customer offers you ₹500 to process their form ahead of others. You:', options: ['Accept, it is small', 'Decline and process in turn', 'Accept and process faster', 'Ask a colleague to take it'], answer: 'Decline and process in turn' },
    { id: 'q5', section: 'Digital comfort', marks: 20, prompt: 'A customer cannot complete UPI registration on their phone. You should:', options: ['Take their phone and do it yourself', 'Guide them step by step on their own phone', 'Ask them to visit a cyber cafe', 'Tell them UPI is unavailable'], answer: 'Guide them step by step on their own phone' },
  ];
  const retailQuestions = [
    { id: 'r1', section: 'Product knowledge', marks: 25, prompt: 'A customer asks the difference between two washing machine models. You should:', options: ['Recommend the costlier one', 'Compare capacity, warranty and price', 'Say both are the same', 'Ask them to search online'], answer: 'Compare capacity, warranty and price' },
    { id: 'r2', section: 'Billing', marks: 25, prompt: 'The POS shows a price different from the shelf tag. You:', options: ['Charge the POS price', 'Check with the supervisor before billing', 'Charge the shelf price silently', 'Cancel the sale'], answer: 'Check with the supervisor before billing' },
    { id: 'r3', section: 'Customer service', marks: 25, prompt: 'A customer wants to return an item without a bill. You:', options: ['Refuse immediately', 'Explain the policy and offer to check the purchase record', 'Accept the return', 'Ignore the request'], answer: 'Explain the policy and offer to check the purchase record' },
    { id: 'r4', section: 'Numeracy', marks: 25, prompt: 'An item costs ₹2,400 with 15% off. What does the customer pay?', options: ['₹2,040', '₹2,160', '₹1,960', '₹2,100'], answer: '₹2,040' },
  ];

  await sql`INSERT INTO app.assessment_template
    (id, industry_key, role_family_key, version, sections, questions, pass_threshold, time_limit_sec, languages, created_at) VALUES
    ('AST-BFSI-RE-1',  'BFSI',   'RELATIONSHIP_EXECUTIVE',     '1.0',
      ${j(['Numeracy','Customer communication','Sales scenario','Integrity','Digital comfort'])},
      ${j(bfsiQuestions)}, 60, 900, ${j(['mr','hi','en'])}, ${T0}),
    ('AST-BFSI-CSA-1', 'BFSI',   'CUSTOMER_SERVICE_ASSOCIATE', '1.0',
      ${j(['Customer communication','Product knowledge','Integrity'])},
      ${j(bfsiQuestions.slice(1, 5))}, 60, 900, ${j(['mr','hi','en'])}, ${T0}),
    ('AST-RTL-SA-1',   'RETAIL', 'SALES_ASSOCIATE',            '0.1',
      ${j(['Product knowledge','Billing','Customer service','Numeracy'])},
      ${j(retailQuestions)}, 55, 720, ${j(['mr','hi','en'])}, ${T0})`;

  // --- role configurations (§22.1) ------------------------------------------
  // Weights total 100. endorsement_cap is a separate, scaled ordering boost
  // bounded by END-07 at 10% of the score — it is NOT a ninth weight.
  const reRules = {
    minAge18: true, requireReconfirmation: true, requireMobileVerified: true,
    requireMandatoryProfile: true, requireWorkAuthDeclaration: true,
    requireLanguageMatch: true, requireSalaryCompatible: true,
    requireShiftCompatible: true, minAssessmentScore: 60,
  };
  const reWeights = {
    jobPreference: 15, commute: 20, compensation: 15, schedule: 10,
    language: 10, experience: 10, criticalSkills: 15, assessment: 5,
  };

  await sql`INSERT INTO app.role_configuration (
    id, industry_key, role_family_key, version, status, candidate_attributes, job_attributes,
    critical_skills, qualification_rules, scoring_weights, endorsement_cap,
    assessment_template_id, assessment_threshold, preview_fields, unlock_fields,
    document_checklist, effective_from, created_at
  ) VALUES
  ('CFG-BFSI-RE-1', 'BFSI', 'RELATIONSHIP_EXECUTIVE', '1.0', 'PUBLISHED',
    ${j([{key:'locality',required:true},{key:'experience_months',required:true},{key:'expected_pay',required:true},{key:'max_commute_min',required:true},{key:'languages',required:true},{key:'shift_availability',required:true},{key:'work_authorised',required:true},{key:'casa_familiarity',required:false},{key:'field_sales_comfort',required:true},{key:'two_wheeler',required:false}])},
    ${j([{key:'fixed_pay',required:true},{key:'variable_max',required:true},{key:'shift',required:true},{key:'weekly_off',required:true}])},
    ${j(['BFSI_SALES','CUSTOMER_COMMUNICATION','TARGET_ACHIEVEMENT'])},
    ${j(reRules)}, ${j(reWeights)}, 5,
    'AST-BFSI-RE-1', 60,
    ${j(['maskedName','locality','travelEstimate','experienceSummary','payFit','skills','assessmentBand','endorsementPoints','explanation'])},
    ${j(['name','phone','locality','experienceMonths','experienceTags','languages','expectedPayPaise','currentPayPaise'])},
    ${j(['identity_proof','address_proof','education_certificate','bank_passbook'])},
    ${T0}, ${T0}),

  ('CFG-BFSI-CSA-1', 'BFSI', 'CUSTOMER_SERVICE_ASSOCIATE', '1.0', 'PUBLISHED',
    ${j([{key:'locality',required:true},{key:'experience_months',required:true},{key:'expected_pay',required:true},{key:'max_commute_min',required:true},{key:'languages',required:true},{key:'shift_availability',required:true},{key:'work_authorised',required:true},{key:'casa_familiarity',required:false}])},
    ${j([{key:'fixed_pay',required:true},{key:'variable_max',required:true},{key:'shift',required:true},{key:'weekly_off',required:true}])},
    ${j(['CUSTOMER_COMMUNICATION','PRODUCT_KNOWLEDGE'])},
    ${j(reRules)},
    ${j({ jobPreference: 15, commute: 20, compensation: 10, schedule: 15, language: 15, experience: 10, criticalSkills: 10, assessment: 5 })},
    5, 'AST-BFSI-CSA-1', 60,
    ${j(['maskedName','locality','travelEstimate','experienceSummary','payFit','skills','assessmentBand','endorsementPoints','explanation'])},
    ${j(['name','phone','locality','experienceMonths','experienceTags','languages','expectedPayPaise'])},
    ${j(['identity_proof','address_proof'])},
    ${T0}, ${T0}),

  ('CFG-RTL-SA-1', 'RETAIL', 'SALES_ASSOCIATE', '0.1', 'SANDBOX',
    ${j([{key:'locality',required:true},{key:'experience_months',required:true},{key:'expected_pay',required:true},{key:'max_commute_min',required:true},{key:'languages',required:true},{key:'shift_availability',required:true},{key:'work_authorised',required:true},{key:'pos_billing',required:true}])},
    ${j([{key:'fixed_pay',required:true},{key:'variable_max',required:true},{key:'shift',required:true},{key:'weekly_off',required:true}])},
    ${j(['RETAIL_SALES','CUSTOMER_COMMUNICATION'])},
    ${j({ ...reRules, minAssessmentScore: 55 })},
    ${j({ jobPreference: 20, commute: 25, compensation: 10, schedule: 10, language: 10, experience: 10, criticalSkills: 10, assessment: 5 })},
    5, 'AST-RTL-SA-1', 55,
    ${j(['maskedName','locality','travelEstimate','experienceSummary','payFit','skills','assessmentBand','explanation'])},
    ${j(['name','phone','locality','experienceMonths','experienceTags','languages','expectedPayPaise'])},
    ${j(['identity_proof','address_proof'])},
    NULL, ${T0})`;

  await sql`INSERT INTO app.configuration_release
    (id, package_name, version, role_config_ids, geography, cohort_flag, approved_by, effective_from, status, created_at) VALUES
    ('REL-BFSI-PUNE-1', 'Pune BFSI launch package', '1.0',
     ${j(['CFG-BFSI-RE-1','CFG-BFSI-CSA-1'])}, 'PUNE', 'PILOT', 'DEMO Platform Admin', ${T0}, 'PUBLISHED', ${T0}),
    ('REL-RTL-SANDBOX-1', 'Retail expansion sandbox', '0.1',
     ${j(['CFG-RTL-SA-1'])}, 'PUNE', 'SANDBOX', NULL, NULL, 'DRAFT', ${T0})`;

  await sql`INSERT INTO app.document_definition (key, industry_key, purpose, required_stage, access_policy, retention_days, created_at) VALUES
    ('identity_proof',        NULL,   'Identity verification', 'ONBOARDING', 'EMPLOYER_CASE_SCOPED', 365, ${T0}),
    ('address_proof',         NULL,   'Address verification',  'ONBOARDING', 'EMPLOYER_CASE_SCOPED', 365, ${T0}),
    ('education_certificate', 'BFSI', 'Eligibility evidence',  'ONBOARDING', 'EMPLOYER_CASE_SCOPED', 365, ${T0}),
    ('bank_passbook',         'BFSI', 'Salary account setup',  'ONBOARDING', 'EMPLOYER_CASE_SCOPED', 365, ${T0})`;

  // --- employers (§22.3) ----------------------------------------------------
  await sql`INSERT INTO app.employer_organisation (id, legal_name, brand_name, gst_pan, billing_contact, status, created_at, status_at) VALUES
    ('EMP-001','DEMO Sahyadri Bank Ltd','DEMO Sahyadri Bank','27AAAAA0000A1Z5','billing@demo-sahyadri.invalid','VERIFIED',${T0},${T0}),
    ('EMP-002','DEMO Deccan Finance Pvt Ltd','DEMO Deccan Finance','27BBBBB1111B1Z5','billing@demo-deccan.invalid','VERIFIED',${T0},${T0}),
    ('EMP-003','DEMO Pragati Microfinance Ltd','DEMO Pragati Microfinance',NULL,'billing@demo-pragati.invalid','PENDING_REVIEW',${T0},${T0})`;

  await sql`INSERT INTO app.employer_location (id, employer_id, name, locality_key, lat, lng, hours, created_at) VALUES
    ('LOC-001','EMP-001','FC Road Branch','shivajinagar',18.5224,73.8412,'09:00-19:00',${T0}),
    ('LOC-002','EMP-001','Kothrud Branch','kothrud',18.5074,73.8077,'09:00-19:00',${T0}),
    ('LOC-003','EMP-002','Viman Nagar Office','viman_nagar',18.5679,73.9143,'10:00-20:00',${T0}),
    ('LOC-004','EMP-003','Hadapsar Office','hadapsar',18.5089,73.9260,'09:00-18:00',${T0})`;

  await sql`INSERT INTO app.employer_user (id, employer_id, name, role, location_scope, created_at) VALUES
    ('EU-001','EMP-001','DEMO Asha Kulkarni','COMPANY_ADMIN',${j([])},${T0}),
    ('EU-002','EMP-001','DEMO Nikhil Patil','BRANCH_RECRUITER',${j(['LOC-002'])},${T0}),
    ('EU-003','EMP-002','DEMO Meera Shah','COMPANY_ADMIN',${j([])},${T0}),
    ('EU-004','EMP-003','DEMO Farhan Shaikh','COMPANY_ADMIN',${j([])},${T0})`;

  // --- partners (§22.4) -----------------------------------------------------
  // PAR-001 carries a PAN and sits near the s.194H threshold in the FY so the
  // withholding path is exercisable; the small neighbourhood partners do not.
  await sql`INSERT INTO app.partner (id, name, partner_type, is_business, capabilities, service_localities, languages, pan, payout_upi, status, created_at, status_at) VALUES
    ('PAR-001','DEMO CareerSetu Services','LOCAL_HIRING_AGENCY',TRUE,${j(['BFSI/RELATIONSHIP_EXECUTIVE','BFSI/CUSTOMER_SERVICE_ASSOCIATE'])},${j(['shivajinagar','deccan'])},${j(['mr','hi','en'])},'AAAPA1234A','careersetu@demoupi','VERIFIED',${T0},${T0}),
    ('PAR-002','DEMO Om Xerox Centre','PRINT_SHOP',TRUE,${j(['BFSI/CUSTOMER_SERVICE_ASSOCIATE'])},${j(['kothrud'])},${j(['mr','hi'])},NULL,'omxerox@demoupi','VERIFIED',${T0},${T0}),
    ('PAR-003','DEMO Quick Mobile Point','MOBILE_RECHARGE_SHOP',TRUE,${j(['BFSI/RELATIONSHIP_EXECUTIVE'])},${j(['hadapsar'])},${j(['mr','hi'])},NULL,'quickmobile@demoupi','VERIFIED',${T0},${T0}),
    ('PAR-004','DEMO Neha Jobs Network','INDEPENDENT_RECRUITER',FALSE,${j(['BFSI/RELATIONSHIP_EXECUTIVE'])},${j(['pimpri'])},${j(['mr','hi','en'])},'BBBPB5678B','nehajobs@demoupi','VERIFIED',${T0},${T0}),
    ('PAR-005','DEMO SkillBridge Centre','TRAINING_CENTRE',TRUE,${j(['BFSI/RELATIONSHIP_EXECUTIVE'])},${j(['viman_nagar'])},${j(['hi','en'])},NULL,'skillbridge@demoupi','SUSPENDED',${T0},${T0})`;

  await sql`INSERT INTO app.partner_site (id, partner_id, locality_key, partner_code, qr_token, status, created_at) VALUES
    ('SITE-001','PAR-001','shivajinagar','DCS101','qr_DCS101_7K2QX','ACTIVE',${T0}),
    ('SITE-002','PAR-002','kothrud','OXC202','qr_OXC202_M4RPD','ACTIVE',${T0}),
    ('SITE-003','PAR-003','hadapsar','QMP303','qr_QMP303_V9TLZ','ACTIVE',${T0}),
    ('SITE-004','PAR-004','pimpri','NJN404','qr_NJN404_B3HWY','ACTIVE',${T0}),
    ('SITE-005','PAR-005','viman_nagar','SBC505','qr_SBC505_X8QNF','SUSPENDED',${T0})`;

  // --- jobs (§22.5) ---------------------------------------------------------
  const liveFrom = T0;
  const jobs: [string, string, string, string, string, number, number, number, string, string, string[], number, string[]][] = [
    ['JOB-001','EMP-001','LOC-001','CFG-BFSI-RE-1','Relationship Executive',5,18000,7000,'09:30-18:30','LIVE',['mr','hi'],6,['BFSI_SALES','CUSTOMER_COMMUNICATION','TARGET_ACHIEVEMENT']],
    ['JOB-002','EMP-001','LOC-002','CFG-BFSI-CSA-1','Customer Service Associate',3,20000,3000,'ROTATIONAL_DAYTIME','LIVE',['mr','hi'],6,['CUSTOMER_COMMUNICATION','PRODUCT_KNOWLEDGE']],
    ['JOB-003','EMP-002','LOC-003','CFG-BFSI-RE-1','Relationship Executive',4,22000,8000,'10:00-19:00','LIVE',['hi','en'],12,['BFSI_SALES','CUSTOMER_COMMUNICATION','TARGET_ACHIEVEMENT']],
    ['JOB-004','EMP-003','LOC-004','CFG-BFSI-RE-1','Relationship Executive',6,17500,6000,'09:00-18:00','PENDING_APPROVAL',['mr','hi'],0,['BFSI_SALES','CUSTOMER_COMMUNICATION']],
    ['JOB-005','EMP-001','LOC-001','CFG-BFSI-RE-1','Relationship Executive',2,18000,5000,'09:30-18:30','EXPIRED',['mr','hi'],6,['BFSI_SALES','CUSTOMER_COMMUNICATION']],
  ];
  for (const [id, emp, loc, cfg, title, openings, fixed, variable, shift, status, langs, minExp, skills] of jobs) {
    const published = status === 'LIVE' ? liveFrom : status === 'EXPIRED' ? addDays(T0, -35) : null;
    const expires = published ? addDays(published, 30) : null;
    await sql`INSERT INTO app.job
      (id, employer_id, location_id, role_config_id, title, openings, fixed_pay_paise, variable_max_paise,
       shift, weekly_off, languages, min_experience_mo, critical_skills, status, published_at, expires_at, created_at)
      VALUES (${id}, ${emp}, ${loc}, ${cfg}, ${title}, ${openings}, ${rupees(fixed)}, ${rupees(variable)},
              ${shift}, 'Sunday', ${j(langs)}, ${minExp}, ${j(skills)}, ${status},
              ${published}, ${expires}, ${published ?? T0})`;

    if (status === 'LIVE') {
      const entId = `ENT-${id.slice(4)}`;
      await sql`INSERT INTO app.posting_entitlement
        (id, job_id, location_id, posting_fee_paise, credits_included, max_distinct_unlocks,
         starts_at, ends_at, credit_expiry_at, created_at)
        VALUES (${entId}, ${id}, ${loc}, ${rupees(2500)}, 10, 100,
                ${published}, ${expires}, ${addDays(published!, 90)}, ${published})`;
      await sql`INSERT INTO app.credit_ledger
        (id, entitlement_id, entry_type, credit_delta, amount_paise, note, created_at)
        VALUES (${'CRD-' + id.slice(4) + '-0'}, ${entId}, 'INCLUDED_GRANT', 10, ${rupees(2500)},
                'Included with ₹2,500 posting entitlement', ${published})`;
    }
  }

  // --- message templates (§22.8) — mr / hi / en ------------------------------
  const templates: [string, string, 'SERVICE'|'UTILITY'|'MARKETING'|'AUTHENTICATION', string, string, string][] = [
    ['welcome','SERVICE','SERVICE',
      'नमस्कार! ही नोकरी शोधण्याची मोफत सेवा आहे. आम्ही तुमच्या जवळच्या बँकेतील नोकऱ्या दाखवतो. भाषा निवडा.',
      'नमस्ते! यह नौकरी खोजने की मुफ़्त सेवा है। हम आपके पास की बैंक नौकरियाँ दिखाते हैं। भाषा चुनें।',
      'Hello! This is a free job-finding service. We show you bank jobs near you. Choose your language.'],
    ['consent_notice','SERVICE','SERVICE',
      'आम्ही तुमचे नाव, पिनकोड, अनुभव आणि अपेक्षित पगार साठवतो — फक्त तुम्हाला नोकरी दाखवण्यासाठी. तुम्ही कधीही ही परवानगी मागे घेऊ शकता. सहमत आहात?',
      'हम आपका नाम, पिनकोड, अनुभव और अपेक्षित वेतन रखते हैं — केवल आपको नौकरी दिखाने के लिए। आप कभी भी सहमति वापस ले सकते हैं। सहमत हैं?',
      'We store your name, pincode, experience and expected pay — only to show you jobs. You can withdraw this at any time. Do you agree?'],
    ['otp','AUTHENTICATION','AUTHENTICATION',
      'तुमचा पडताळणी कोड {{code}} आहे.', 'आपका सत्यापन कोड {{code}} है।', 'Your verification code is {{code}}.'],
    ['source_confirm','SERVICE','SERVICE',
      'तुम्ही {{partner}} मार्फत आला आहात. बरोबर नसेल तर "बदला" लिहा.',
      'आप {{partner}} के ज़रिए आए हैं। सही नहीं है तो "बदलें" लिखें।',
      'You came through {{partner}}. If that is not right, reply "change".'],
    ['job_alert','MARKETING','MARKETING',
      '{{employer}} — {{title}}, {{locality}}. निश्चित {{fixed}}/महिना. प्रवास सुमारे {{minutes}} मिनिटे. अर्ज करायचा?',
      '{{employer}} — {{title}}, {{locality}}. निश्चित {{fixed}}/माह. यात्रा लगभग {{minutes}} मिनट। आवेदन करें?',
      '{{employer}} — {{title}} in {{locality}}. {{fixed}}/month fixed. About {{minutes}} minutes travel. Apply?'],
    ['application_confirm','UTILITY','UTILITY',
      'तुमचा अर्ज {{employer}} कडे पाठवला आहे. ही सेवा पूर्णपणे मोफत आहे.',
      'आपका आवेदन {{employer}} को भेज दिया गया है। यह सेवा पूरी तरह मुफ़्त है।',
      'Your application has gone to {{employer}}. This service is completely free.'],
    ['reconfirm_interest','UTILITY','UTILITY',
      '{{employer}} च्या {{title}} पदासाठी तुम्हाला अजूनही रस आहे का? हो / नाही',
      'क्या आप {{employer}} की {{title}} भूमिका में अब भी रुचि रखते हैं? हाँ / नहीं',
      'Are you still interested in the {{title}} role at {{employer}}? Yes / No'],
    ['shared_with_employer','UTILITY','UTILITY',
      'तुमचा प्रोफाइल {{employer}} ने पाहिला आहे. ते लवकरच संपर्क करू शकतात. कोणी पैसे मागितले तर लगेच कळवा.',
      'आपका प्रोफ़ाइल {{employer}} ने देखा है। वे जल्द संपर्क कर सकते हैं। कोई पैसे माँगे तो तुरंत बताएँ।',
      'Your profile has been opened by {{employer}}. They may contact you soon. Tell us at once if anyone asks you for money.'],
    ['endorsement_invite','UTILITY','UTILITY',
      '{{candidate}} यांनी तुम्हाला त्यांच्या कामाबद्दल थोडक्यात सांगण्याची विनंती केली आहे. दुवा: {{link}}',
      '{{candidate}} ने आपसे उनके काम के बारे में कुछ बताने का अनुरोध किया है। लिंक: {{link}}',
      '{{candidate}} has asked you to say a few words about their work. Link: {{link}}'],
    ['delivery_failure_fallback','UTILITY','UTILITY',
      'आम्ही तुमच्यापर्यंत पोहोचू शकलो नाही. SMS पाठवत आहोत.',
      'हम आप तक नहीं पहुँच सके। SMS भेज रहे हैं।',
      'We could not reach you on WhatsApp. Sending an SMS instead.'],
    ['opt_out','SERVICE','SERVICE',
      'तुम्हाला यापुढे नोकरीचे संदेश येणार नाहीत. पुन्हा सुरू करण्यासाठी "सुरू" लिहा.',
      'अब आपको नौकरी के संदेश नहीं आएँगे। दोबारा शुरू करने के लिए "शुरू" लिखें।',
      'You will not get job messages any more. Reply "start" to turn them back on.'],
  ];
  for (const [key, , category, mr, hi, en] of templates) {
    await sql`INSERT INTO app.message_template (key, language, category, body) VALUES
      (${key},'mr',${category},${mr}), (${key},'hi',${category},${hi}), (${key},'en',${category},${en})`;
  }

  // --- candidates (§22.6), created through the real registration path --------
  interface SeedCandidate {
    phone: string; name: string; lang: 'mr'|'hi'|'en'; locality: string;
    site: string | null; method: 'QR'|'PARTNER_CODE'|'DIRECT';
    months: number; tags: string[]; langs: string[]; expected: number;
    current: number | null; commute: number; shifts: string[]; score: number;
  }
  const seedCandidates: SeedCandidate[] = [
    { phone:'+910000000001', name:'DEMO Aarav Deshmukh', lang:'mr', locality:'shivajinagar', site:'qr_DCS101_7K2QX', method:'QR',
      months:18, tags:['FIELD_SALES','CUSTOMER_COMMUNICATION'], langs:['mr','hi'], expected:20000, current:16000, commute:45, shifts:['ANY'], score:82 },
    { phone:'+910000000002', name:'DEMO Sana Shaikh', lang:'hi', locality:'kothrud', site:'OXC202', method:'PARTNER_CODE',
      months:12, tags:['CUSTOMER_SERVICE','CUSTOMER_COMMUNICATION'], langs:['mr','hi'], expected:21000, current:17000, commute:45, shifts:['ANY'], score:76 },
    { phone:'+910000000003', name:'DEMO Rohan Jadhav', lang:'mr', locality:'hadapsar', site:'qr_QMP303_V9TLZ', method:'QR',
      months:0, tags:['COMMERCE_GRADUATE'], langs:['mr','hi','en'], expected:18000, current:null, commute:60, shifts:['ANY'], score:68 },
    { phone:'+910000000004', name:'DEMO Priya Nair', lang:'en', locality:'viman_nagar', site:null, method:'DIRECT',
      months:30, tags:['BFSI_SALES','CUSTOMER_COMMUNICATION','TARGET_ACHIEVEMENT'], langs:['hi','en'], expected:24000, current:21000, commute:60, shifts:['ANY'], score:91 },
    { phone:'+910000000005', name:'DEMO Imran Khan', lang:'hi', locality:'pimpri', site:'NJN404', method:'PARTNER_CODE',
      months:24, tags:['TELECOM_SALES','TARGET_ACHIEVEMENT'], langs:['mr','hi'], expected:19000, current:17500, commute:75, shifts:['ANY'], score:73 },
    { phone:'+910000000006', name:'DEMO Kavya More', lang:'mr', locality:'kothrud', site:'qr_OXC202_M4RPD', method:'QR',
      months:6, tags:['RETAIL_SALES'], langs:['mr'], expected:18000, current:14000, commute:45, shifts:['ANY'], score:54 },
    { phone:'+910000000007', name:'DEMO Dev Mehta', lang:'en', locality:'baner', site:'qr_DCS101_7K2QX', method:'QR',
      months:14, tags:['SALES','CUSTOMER_COMMUNICATION'], langs:['hi','en'], expected:20000, current:18000, commute:60, shifts:['ANY'], score:79 },
    { phone:'+910000000008', name:'DEMO Anaya Joshi', lang:'hi', locality:'aundh', site:'qr_SBC505_X8QNF', method:'QR',
      months:20, tags:['BFSI_SERVICE','CUSTOMER_COMMUNICATION'], langs:['mr','hi'], expected:22000, current:19500, commute:60, shifts:['ANY'], score:85 },
  ];

  const created: string[] = [];
  for (const c of seedCandidates) {
    const reg = await startRegistration({ phone: c.phone, language: c.lang, siteCode: c.site, method: c.method });
    const id = reg.candidateId;
    created.push(id);
    await verifyAndBind(id, reg.pendingAttribution ?? null);
    await grantConsent(id, 'PROCESSING');
    await grantConsent(id, 'JOB_ALERTS');
    if (c.site) await grantConsent(id, 'PARTNER_ASSISTANCE');
    await completeProfile(id, {
      name: c.name, localityKey: c.locality, age18: true,
      experienceMonths: c.months, experienceTags: c.tags, languages: c.langs,
      currentPayPaise: c.current === null ? null : rupees(c.current),
      expectedPayPaise: rupees(c.expected),
      maxCommuteMin: c.commute, shiftAvailability: c.shifts,
    });
    const templateId = c.locality === 'kothrud' && c.tags.includes('CUSTOMER_SERVICE')
      ? 'AST-BFSI-CSA-1' : 'AST-BFSI-RE-1';
    await seedAssessmentScore(id, templateId, c.score, T0);
  }

  // --- endorsements (§22.6) -------------------------------------------------
  const e1 = await inviteEndorsement(created[0], 'DEMO Vikram Rao', '+910000009001',
    'FORMER_MANAGER', ['CUSTOMER_COMMUNICATION', 'RELIABILITY'], 'Reliable, handled walk-in customers well.');
  await verifyEndorsement(e1.id);

  const e2 = await inviteEndorsement(created[2], 'DEMO Leena Pawar', '+910000009002',
    'SENIOR_COLLEAGUE', ['LEARNING_AGILITY'], 'Picks up new processes quickly.');
  await verifyEndorsement(e2.id);

  // END-003 — a self/duplicate attempt that must score zero and open a case
  const e3 = await inviteEndorsement(created[5], 'DEMO Duplicate Contact', '+910000000006',
    'SELF_OR_DUPLICATE', ['SALES'], 'Self-submitted.');
  await verifyEndorsement(e3.id);

  // --- applications and matches (§22.7), computed by the real engine ---------
  for (const cid of [created[0], created[2], created[3], created[4], created[5]]) {
    await applyAndEvaluate(cid, 'JOB-001');
  }
  await applyAndEvaluate(created[1], 'JOB-002');
  await applyAndEvaluate(created[7], 'JOB-003');

  // CAN-007 — consent withdrawn test case. Applies first, then withdraws, so
  // the withdrawal path is exercised rather than asserted.
  await applyAndEvaluate(created[6], 'JOB-001');
  await withdrawConsent(created[6], 'PROCESSING');

  // --- commercial events (§22.7) -------------------------------------------
  // UNL-001 — Asha unlocks CAN-001 for JOB-001; PAR-001 reward enters hold.
  const u1 = await unlockQualifiedProfile('EMP-001', 'JOB-001', created[0], 'EU-001');
  console.log('  UNL-001:', u1.status, u1.unlockId ?? u1.reason);

  // UNL-002 — invalid-phone simulation. Employer raises a replacement inside
  // the 72h window; operations approves; credit restored, PAR-003 reward reversed.
  const u2 = await unlockQualifiedProfile('EMP-001', 'JOB-001', created[2], 'EU-001');
  console.log('  UNL-002:', u2.status, u2.unlockId ?? u2.reason);
  if (u2.unlockId) {
    const rc = await raiseReplacement(u2.unlockId, 'INVALID_CONTACT',
      'Number unreachable on three attempts across two days; call log attached.');
    if ('id' in rc) await decideReplacement(rc.id, 'APPROVED', 'OPS-001');
  }

  // Mature the hold on UNL-001 so the finance console has something to pay,
  // then build the weekly batch. Advancing the demo clock is exactly how the
  // 72-hour hold is demonstrated live.
  await sql`UPDATE app.demo_clock SET now_at = ${addHours(T0, 73)} WHERE id = 1`;
  const released = await releaseMaturedHolds();
  const batch = await buildPayoutBatch('FIN-001');
  await sql`UPDATE app.demo_clock SET now_at = ${T0} WHERE id = 1`;
  console.log(`  holds released: ${released}; payouts created: ${batch.created.length}; skipped: ${batch.skipped.length}`);
  for (const s of batch.skipped) {
    console.log(`    skipped ${s.partnerId}: ${s.reason} (balance ₹${s.balancePaise / 100})`);
  }

  const [{ n: matchCount }] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM app.match_result`;
  console.log(`\nSeed complete. ${created.length} candidates, ${matchCount} match results.`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
