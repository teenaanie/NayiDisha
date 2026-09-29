/**
 * The WhatsApp registration form, defined once.
 *
 * The simulator renders it as a WhatsApp-style sheet, `metaFlowJson()` exports
 * it as a Meta WhatsApp Flow for the production number, and
 * `validateSubmission()` checks what either one sends back. Changing a field
 * here changes all three, so the demo cannot drift from what ships.
 */

export type FlowLang = 'en' | 'hi' | 'mr';

/** A problem with what the candidate entered; its message is safe to show them. */
export class FormError extends Error {}
type L = Record<FlowLang, string>;

export interface Option { id: string; title: L }
export interface FlowField {
  name: string;
  label: L;
  kind: 'text' | 'email' | 'number' | 'date' | 'dropdown' | 'checkboxes' | 'optin' | 'document';
  required: boolean;
  options?: Option[];
  min?: number; max?: number;
  helper?: L;
}
export interface FlowScreen { id: string; title: L; fields: FlowField[] }

const o = (id: string, en: string, hi: string, mr: string): Option => ({ id, title: { en, hi, mr } });

export const GENDERS = [o('FEMALE', 'Female', 'महिला', 'स्त्री'), o('MALE', 'Male', 'पुरुष', 'पुरुष'), o('OTHER', 'Other', 'अन्य', 'इतर'), o('UNDISCLOSED', 'Prefer not to say', 'नहीं बताना चाहते', 'सांगू इच्छित नाही')];
export const QUALIFICATIONS = [
  o('BELOW_10TH', 'Below 10th', '10वीं से कम', '१० वी पेक्षा कमी'), o('10TH', '10th pass', '10वीं पास', '१० वी उत्तीर्ण'),
  o('12TH', '12th pass', '12वीं पास', '१२ वी उत्तीर्ण'), o('DIPLOMA_ITI', 'Diploma / ITI', 'डिप्लोमा / ITI', 'डिप्लोमा / ITI'),
  o('GRADUATE', 'Graduate', 'स्नातक', 'पदवीधर'), o('POST_GRADUATE', 'Post-graduate', 'स्नातकोत्तर', 'पदव्युत्तर'),
];
export const INDUSTRIES = [
  o('NONE', 'Not working / fresher', 'अभी काम नहीं / फ्रेशर', 'सध्या काम नाही / फ्रेशर'),
  o('BFSI', 'Banking & financial services', 'बैंकिंग व वित्तीय सेवाएँ', 'बँकिंग व वित्तीय सेवा'),
  o('RETAIL', 'Retail', 'रिटेल', 'रिटेल'), o('LOGISTICS', 'Logistics & delivery', 'लॉजिस्टिक्स व डिलीवरी', 'लॉजिस्टिक्स व डिलिव्हरी'),
  o('TELECOM', 'Telecom', 'टेलीकॉम', 'टेलिकॉम'), o('HOSPITALITY', 'Hospitality', 'हॉस्पिटैलिटी', 'हॉस्पिटॅलिटी'),
  o('HEALTHCARE', 'Healthcare', 'स्वास्थ्य सेवा', 'आरोग्य सेवा'), o('MANUFACTURING', 'Manufacturing', 'विनिर्माण', 'उत्पादन'),
  o('IT_ITES', 'IT / BPO', 'IT / BPO', 'IT / BPO'), o('EDUCATION', 'Education', 'शिक्षा', 'शिक्षण'), o('OTHER', 'Other', 'अन्य', 'इतर'),
];
export const LANGUAGES = [
  o('en', 'English', 'अंग्रेज़ी', 'इंग्रजी'), o('hi', 'Hindi', 'हिन्दी', 'हिंदी'), o('mr', 'Marathi', 'मराठी', 'मराठी'),
  o('gu', 'Gujarati', 'गुजराती', 'गुजराती'), o('ta', 'Tamil', 'तमिल', 'तमिळ'), o('te', 'Telugu', 'तेलुगु', 'तेलुगू'),
  o('kn', 'Kannada', 'कन्नड़', 'कन्नड'), o('bn', 'Bengali', 'बंगाली', 'बंगाली'),
];

export const SHIFTS = [o('ANY', 'Any shift', 'कोई भी शिफ्ट', 'कोणतीही शिफ्ट'), o('09:30-18:30', 'Daytime (9:30 to 6:30)', 'दिन (9:30 से 6:30)', 'दिवसा (9:30 ते 6:30)'), o('ROTATIONAL_DAYTIME', 'Rotational daytime', 'रोटेशनल दिन', 'फिरती दिवसपाळी'), o('10:00-19:00', 'Late day (10 to 7)', 'दोपहर (10 से 7)', 'उशिरा दिवस (10 ते 7)')];

export const REGISTRATION_FLOW: FlowScreen[] = [
  {
    id: 'CONSENT', title: { en: 'Before we start', hi: 'शुरू करने से पहले', mr: 'सुरू करण्यापूर्वी' },
    fields: [
      { name: 'consent_processing', kind: 'optin', required: true, label: {
        en: 'I allow NayiDisha to use these details and my resume to match me with jobs. Contact details are shared with an employer only after I apply and confirm. I can withdraw this later.',
        hi: 'मैं NayiDisha को नौकरियों से मिलान के लिए यह जानकारी और मेरा रिज़्यूमे उपयोग करने की अनुमति देता/देती हूँ। संपर्क विवरण आवेदन और पुष्टि के बाद ही नियोक्ता को दिए जाते हैं। मैं इसे बाद में वापस ले सकता/सकती हूँ।',
        mr: 'नोकऱ्यांशी जुळवण्यासाठी ही माहिती आणि माझा रिझ्युमे वापरण्याची मी NayiDisha ला परवानगी देतो/देते. अर्ज आणि पुष्टी केल्यानंतरच संपर्क तपशील नियोक्त्याला दिले जातात. मी ही परवानगी नंतर मागे घेऊ शकतो/शकते.' } },
      { name: 'consent_alerts', kind: 'optin', required: false, label: { en: 'Send me job alerts on WhatsApp (optional)', hi: 'मुझे WhatsApp पर नौकरी अलर्ट भेजें (वैकल्पिक)', mr: 'मला WhatsApp वर नोकरी सूचना पाठवा (ऐच्छिक)' } },
    ],
  },
  {
    id: 'ABOUT', title: { en: 'About you', hi: 'आपके बारे में', mr: 'तुमच्याबद्दल' },
    fields: [
      { name: 'full_name', kind: 'text', required: true, label: { en: 'Full name', hi: 'पूरा नाम', mr: 'पूर्ण नाव' } },
      { name: 'email', kind: 'email', required: true, label: { en: 'Email ID', hi: 'ईमेल आईडी', mr: 'ईमेल आयडी' } },
      { name: 'pin_code', kind: 'number', required: true, label: { en: 'Pin code', hi: 'पिन कोड', mr: 'पिन कोड' } },
      { name: 'date_of_birth', kind: 'date', required: true, label: { en: 'Date of birth', hi: 'जन्म तिथि', mr: 'जन्मतारीख' } },
      { name: 'gender', kind: 'dropdown', required: true, options: GENDERS, label: { en: 'Gender', hi: 'लिंग', mr: 'लिंग' } },
    ],
  },
  {
    id: 'WORK', title: { en: 'Your work', hi: 'आपका काम', mr: 'तुमचे काम' },
    fields: [
      { name: 'highest_qualification', kind: 'dropdown', required: true, options: QUALIFICATIONS, label: { en: 'Highest qualification', hi: 'सर्वोच्च योग्यता', mr: 'सर्वोच्च शिक्षण' } },
      { name: 'experience_years', kind: 'number', required: true, min: 0, max: 50, label: { en: 'Total years of experience', hi: 'कुल अनुभव (वर्ष)', mr: 'एकूण अनुभव (वर्षे)' } },
      { name: 'current_industry', kind: 'dropdown', required: true, options: INDUSTRIES, label: { en: 'Current industry', hi: 'वर्तमान उद्योग', mr: 'सध्याचा उद्योग' } },
      { name: 'current_job_role', kind: 'text', required: false, label: { en: 'Current job role', hi: 'वर्तमान पद', mr: 'सध्याचे पद' } },
      { name: 'current_company', kind: 'text', required: false, label: { en: 'Current company', hi: 'वर्तमान कंपनी', mr: 'सध्याची कंपनी' } },
      { name: 'languages_known', kind: 'checkboxes', required: true, options: LANGUAGES, label: { en: 'Languages known', hi: 'कौन-सी भाषाएँ आती हैं', mr: 'येणाऱ्या भाषा' } },
    ],
  },
  {
    id: 'PAY', title: { en: 'Pay and resume', hi: 'वेतन और रिज़्यूमे', mr: 'पगार आणि रिझ्युमे' },
    fields: [
      { name: 'current_salary', kind: 'number', required: false, min: 0, max: 1000000, label: { en: 'Current monthly salary (₹)', hi: 'वर्तमान मासिक वेतन (₹)', mr: 'सध्याचा मासिक पगार (₹)' }, helper: { en: 'Leave blank if not working', hi: 'काम नहीं कर रहे तो खाली छोड़ें', mr: 'काम करत नसल्यास रिकामे ठेवा' } },
      { name: 'expected_salary', kind: 'number', required: true, min: 1000, max: 1000000, label: { en: 'Expected monthly salary (₹)', hi: 'अपेक्षित मासिक वेतन (₹)', mr: 'अपेक्षित मासिक पगार (₹)' } },
    ],
  },
  {
    id: 'AVAILABILITY', title: { en: 'Where you can work', hi: 'आप कहाँ काम कर सकते हैं', mr: 'तुम्ही कुठे काम करू शकता' },
    fields: [
      { name: 'max_commute_min', kind: 'number', required: true, min: 5, max: 240, label: { en: 'How far can you travel to work? (minutes)', hi: 'काम के लिए कितनी दूर जा सकते हैं? (मिनट)', mr: 'कामासाठी किती लांब जाऊ शकता? (मिनिटे)' } },
      { name: 'shift_availability', kind: 'checkboxes', required: true, options: SHIFTS, label: { en: 'Which shifts suit you', hi: 'कौन सी शिफ्ट ठीक है', mr: 'कोणती शिफ्ट योग्य आहे' } },
      { name: 'experience_tags', kind: 'text', required: false, label: { en: 'Work you have done before (comma separated)', hi: 'पहले किया हुआ काम (कॉमा से अलग)', mr: 'आधी केलेलं काम (स्वल्पविरामाने वेगळं)' }, helper: { en: 'For example: field sales, customer service', hi: 'जैसे: फील्ड सेल्स, कस्टमर सर्विस', mr: 'उदा: फील्ड सेल्स, कस्टमर सर्विस' } },
      { name: 'resume', kind: 'document', required: false, label: { en: 'Upload your resume (optional — PDF or Word, up to 4 MB)', hi: 'अपना रिज़्यूमे अपलोड करें (PDF या Word, 4 MB तक)', mr: 'तुमचा रिझ्युमे अपलोड करा (PDF किंवा Word, 4 MB पर्यंत)' } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Validation — shared by the simulator and the production webhook
// ---------------------------------------------------------------------------

export interface Registration {
  consentProcessing: true;
  consentAlerts: boolean;
  fullName: string;
  email: string;
  pinCode: string;
  dateOfBirth: string;
  gender: string;
  highestQualification: string;
  experienceYears: number;
  currentIndustry: string;
  currentJobRole: string | null;
  currentCompany: string | null;
  languagesKnown: string[];
  currentSalary: number | null;
  expectedSalary: number;
  maxCommuteMin: number;
  shiftAvailability: string[];
  experienceTags: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const opt = (list: Option[], v: unknown, label: string) => {
  const s = str(v);
  if (!list.some((x) => x.id === s)) throw new FormError(`Choose your ${label}.`);
  return s;
};
const num = (v: unknown, label: string, min: number, max: number) => {
  const n = Number(str(v));
  if (!str(v) || !Number.isFinite(n) || n < min || n > max) throw new FormError(`${label} must be a number between ${min} and ${max}.`);
  return n;
};

export function ageOn(dob: string, today: Date): number {
  const d = new Date(dob + 'T00:00:00Z');
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export function validateSubmission(p: Record<string, unknown>, today: Date): Registration {
  if (p.consent_processing !== true && p.consent_processing !== 'true' && p.consent_processing !== 'on') {
    throw new FormError('Your permission to process these details is needed to register you.');
  }
  const fullName = str(p.full_name);
  if (fullName.length < 2 || fullName.length > 120) throw new FormError('Enter your full name.');
  const email = str(p.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) throw new FormError('Enter a valid email ID.');
  const pinCode = str(p.pin_code);
  if (!/^[1-9][0-9]{5}$/.test(pinCode)) throw new FormError('Enter a 6-digit pin code.');
  const dateOfBirth = str(p.date_of_birth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth))) throw new FormError('Enter your date of birth.');
  const age = ageOn(dateOfBirth, today);
  if (age < 18) throw new FormError('NayiDisha is for people aged 18 or above.');
  if (age > 80) throw new FormError('Check your date of birth.');
  const languages = (Array.isArray(p.languages_known) ? p.languages_known : str(p.languages_known).split(','))
    .map(str).filter((l) => LANGUAGES.some((x) => x.id === l));
  if (!languages.length) throw new FormError('Choose at least one language you know.');
  const shifts = (Array.isArray(p.shift_availability) ? p.shift_availability : str(p.shift_availability).split(','))
    .map(str).filter((x) => SHIFTS.some((s) => s.id === x));
  if (!shifts.length) throw new FormError('Choose at least one shift you can work.');
  const currentIndustry = opt(INDUSTRIES, p.current_industry, 'current industry');
  const optionalText = (v: unknown) => { const s = str(v).slice(0, 120); return s || null; };
  return {
    consentProcessing: true,
    consentAlerts: p.consent_alerts === true || p.consent_alerts === 'true' || p.consent_alerts === 'on',
    fullName, email, pinCode, dateOfBirth,
    gender: opt(GENDERS, p.gender, 'gender'),
    highestQualification: opt(QUALIFICATIONS, p.highest_qualification, 'highest qualification'),
    experienceYears: num(p.experience_years, 'Years of experience', 0, 50),
    currentIndustry,
    currentJobRole: optionalText(p.current_job_role),
    currentCompany: optionalText(p.current_company),
    languagesKnown: Array.from(new Set(languages)),
    currentSalary: str(p.current_salary) ? num(p.current_salary, 'Current salary', 0, 1_000_000) : null,
    expectedSalary: num(p.expected_salary, 'Expected salary', 1000, 1_000_000),
    maxCommuteMin: num(p.max_commute_min, 'Commute', 5, 240),
    shiftAvailability: shifts,
    // Free text, upper-cased into the tags matching scores against.
    experienceTags: str(p.experience_tags).split(',').map((t) => t.trim().toUpperCase().replace(/\s+/g, '_')).filter(Boolean).slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Export as a Meta WhatsApp Flow (Flow JSON). Upload this in WhatsApp Manager.
// ---------------------------------------------------------------------------

export function metaFlowJson(lang: FlowLang = 'en') {
  const component = (f: FlowField) => {
    const label = f.label[lang];
    switch (f.kind) {
      case 'optin': return { type: 'OptIn', name: f.name, label, required: f.required };
      case 'dropdown': return { type: 'Dropdown', name: f.name, label, required: f.required, 'data-source': f.options!.map((x) => ({ id: x.id, title: x.title[lang] })) };
      case 'checkboxes': return { type: 'CheckboxGroup', name: f.name, label, required: f.required, 'data-source': f.options!.map((x) => ({ id: x.id, title: x.title[lang] })) };
      case 'date': return { type: 'DatePicker', name: f.name, label, required: f.required };
      case 'document': return { type: 'DocumentPicker', name: f.name, label, 'min-uploaded-documents': f.required ? 1 : 0, 'max-uploaded-documents': 1, 'max-file-size-kb': 4096, 'allowed-mime-types': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] };
      default: return { type: 'TextInput', name: f.name, label, required: f.required, 'input-type': f.kind === 'email' ? 'email' : f.kind === 'number' ? 'number' : 'text', ...(f.helper ? { 'helper-text': f.helper[lang] } : {}) };
    }
  };
  return {
    version: '6.0',
    screens: REGISTRATION_FLOW.map((screen, i) => {
      const last = i === REGISTRATION_FLOW.length - 1;
      const next = REGISTRATION_FLOW[i + 1];
      const earlier = REGISTRATION_FLOW.slice(0, i).flatMap((s) => s.fields.map((f) => f.name));
      // Each screen passes everything collected so far forward, so the last one can complete with the lot.
      const carry = Object.fromEntries([...earlier, ...screen.fields.map((f) => f.name)].map((n) =>
        [n, earlier.includes(n) ? `\${data.${n}}` : `\${form.${n}}`]));
      return {
        id: screen.id,
        title: screen.title[lang],
        ...(last ? { terminal: true } : {}),
        ...(i > 0 ? { data: Object.fromEntries(earlier.map((n) => [n, { type: 'string', __example__: '' }])) } : {}),
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form', name: `${screen.id.toLowerCase()}_form`,
            children: [
              ...screen.fields.map(component),
              {
                type: 'Footer', label: last ? 'Submit' : 'Continue',
                'on-click-action': last
                  ? { name: 'complete', payload: carry }
                  : { name: 'navigate', next: { type: 'screen', name: next.id }, payload: carry },
              },
            ],
          }],
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The two stages
// ---------------------------------------------------------------------------

/**
 * Which answers the matching engine gates on, and which are background.
 *
 * Both journeys collect the same set in the end. They differ only in when: the
 * QR journey asks the matching ones first so a real shortlist appears while the
 * candidate is still paying attention, and the rest when they tap Apply — at
 * which point they can see what the questions are for. The invite journey,
 * already sitting in a chat the candidate opted into, asks in one pass.
 *
 * Derived from REGISTRATION_FLOW rather than listed twice, so a field added to
 * the form cannot go missing from a stage.
 */
export const DETAIL_FIELD_NAMES = [
  'email', 'date_of_birth', 'gender', 'highest_qualification',
  'current_industry', 'current_job_role', 'current_company', 'current_salary', 'resume',
] as const;

const isDetail = (name: string) => (DETAIL_FIELD_NAMES as readonly string[]).includes(name);

/** The background half, as screens, for the QR journey to ask before applying. */
export const DETAIL_SCREENS: FlowScreen[] = REGISTRATION_FLOW
  .map((screen) => ({ ...screen, fields: screen.fields.filter((f) => isDetail(f.name)) }))
  .filter((screen) => screen.fields.length > 0);

export interface ProfileDetails {
  email: string;
  dateOfBirth: string;
  gender: string;
  highestQualification: string;
  currentIndustry: string;
  currentJobRole: string | null;
  currentCompany: string | null;
  currentSalary: number | null;
}

/** The same rules validateSubmission applies, over the background half alone. */
export function validateProfileDetails(p: Record<string, unknown>, today: Date): ProfileDetails {
  const email = str(p.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) throw new FormError('Enter a valid email ID.');
  const dateOfBirth = str(p.date_of_birth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth))) throw new FormError('Enter your date of birth.');
  const age = ageOn(dateOfBirth, today);
  if (age < 18) throw new FormError('NayiDisha is for people aged 18 or above.');
  if (age > 80) throw new FormError('Check your date of birth.');
  const optionalText = (v: unknown) => { const t = str(v).slice(0, 120); return t || null; };
  return {
    email, dateOfBirth,
    gender: opt(GENDERS, p.gender, 'gender'),
    highestQualification: opt(QUALIFICATIONS, p.highest_qualification, 'highest qualification'),
    currentIndustry: opt(INDUSTRIES, p.current_industry, 'current industry'),
    currentJobRole: optionalText(p.current_job_role),
    currentCompany: optionalText(p.current_company),
    currentSalary: str(p.current_salary) ? num(p.current_salary, 'Current salary', 0, 1_000_000) : null,
  };
}

/**
 * What each field looks like to a speech interpreter.
 *
 * Only the fields where speaking is actually better than tapping. Email and
 * date of birth are missing on purpose: a misheard email is a candidate nobody
 * can reach, and a misheard date silently trips the age gate. Consent and the
 * resume are a tap and a file. Multi-selects stay tapped too — "Marathi and
 * Hindi and English" is a list, and a half-heard list is worse than no list.
 */
export const VOICE_FIELD_SPECS: Record<string, {
  key: string; dataType: 'TEXT' | 'INT' | 'ENUM'; expected: string; allowedValues?: string[];
  /**
   * Reuse one of the profile journey's own handlers instead of the generic
   * reading. Those are the ones covered by voice-parse-check's 31 phrases, and
   * they know things the generic path does not — that "अठारह हज़ार" is 18000
   * and not 18, and that "My name is Meena" is a name with a lead-in on it.
   */
  via?: 'name' | 'expectedPay' | 'commute' | 'skills' | 'experienceMonths';
}> = {
  full_name:             { key: 'full_name', dataType: 'TEXT', expected: "the person's full name", via: 'name' },
  pin_code:              { key: 'pin_code', dataType: 'INT', expected: 'a six digit Indian pin code' },
  experience_years:      { key: 'experience_years', dataType: 'INT', expected: 'total work experience in whole YEARS', via: 'experienceMonths' },
  current_job_role:      { key: 'current_job_role', dataType: 'TEXT', expected: 'their current job title' },
  current_company:       { key: 'current_company', dataType: 'TEXT', expected: 'the company they work for' },
  current_salary:        { key: 'current_salary', dataType: 'INT', expected: 'current monthly pay as a whole number of rupees', via: 'expectedPay' },
  expected_salary:       { key: 'expected_salary', dataType: 'INT', expected: 'expected monthly pay as a whole number of rupees', via: 'expectedPay' },
  max_commute_min:       { key: 'max_commute_min', dataType: 'INT', expected: 'maximum one-way commute in MINUTES', via: 'commute' },
  experience_tags:       { key: 'experience_tags', dataType: 'TEXT', expected: 'the kinds of work they have done before', via: 'skills' },
  gender:                { key: 'gender', dataType: 'ENUM', expected: 'one of FEMALE, MALE, OTHER, UNDISCLOSED', allowedValues: GENDERS.map((g) => g.id) },
  highest_qualification: { key: 'highest_qualification', dataType: 'ENUM', expected: 'one of ' + QUALIFICATIONS.map((q) => q.id).join(', '), allowedValues: QUALIFICATIONS.map((q) => q.id) },
  current_industry:      { key: 'current_industry', dataType: 'ENUM', expected: 'one of ' + INDUSTRIES.map((i) => i.id).join(', '), allowedValues: INDUSTRIES.map((i) => i.id) },
};

/** The spoken form of the registration form, in the order the screens ask. */
export const VOICE_SCRIPT: { field: string; ask: Record<FlowLang, string> }[] = REGISTRATION_FLOW
  .flatMap((s) => s.fields)
  .filter((f) => !!VOICE_FIELD_SPECS[f.name])
  .map((f) => ({ field: f.name, ask: { en: f.label.en, hi: f.label.hi, mr: f.label.mr } }));
