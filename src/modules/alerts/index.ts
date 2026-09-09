import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { activeCommercialPolicy } from '@/modules/configuration';
import { messagingProvider } from '@/modules/adapters/messaging';
import { travelProvider } from '@/modules/adapters/travel';
import { formatINR } from '@/lib/money';

/**
 * Job alerts and partner activation (§8.6).
 *
 * A published job pushes to two audiences with very different rules:
 *
 *   Candidates get a message only if they consented to alerts, only in their
 *   own language, only outside their quiet hours, and only within their weekly
 *   frequency cap (ALT-02). The message offers actions rather than a wall of
 *   text (ALT-04).
 *
 *   Partners get role, location, pay and the bounty — and never candidate data
 *   (ALT-03). The bounty is shown before they source anyone (REF-04).
 *
 * Alerts are the paid part of the WhatsApp channel: they are proactive
 * marketing-category messages, unlike the registration conversation which the
 * candidate starts and which is therefore free. Every suppression below is
 * money not spent as well as goodwill not burned.
 */

export interface AlertOutcome {
  candidatesAlerted: number;
  partnersAlerted: number;
  suppressed: { candidateId: string; reason: string }[];
}

/** IST hour, from the demo clock. Quiet hours are a candidate-facing promise. */
function istHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
  }).format(d));
}

function inQuietHours(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

export async function dispatchJobAlerts(jobId: string): Promise<AlertOutcome> {
  const at = await now();
  const policy = await activeCommercialPolicy();
  const suppressed: AlertOutcome['suppressed'] = [];

  const [job] = await sql<{
    id: string; title: string; status: string; employer_id: string; brand: string;
    loc_name: string; locality_key: string; lat: number; lng: number;
    fixed_pay_paise: string; shift: string; languages: string[];
    role_config_id: string; role_family_key: string; industry_key: string;
  }[]>`
    SELECT j.id, j.title, j.status, j.employer_id, e.brand_name AS brand,
           l.name AS loc_name, l.locality_key, l.lat, l.lng,
           j.fixed_pay_paise, j.shift, j.languages, j.role_config_id,
           rc.role_family_key, rc.industry_key
      FROM app.job j
      JOIN app.employer_organisation e ON e.id = j.employer_id
      JOIN app.employer_location l ON l.id = j.location_id
      JOIN app.role_configuration rc ON rc.id = j.role_config_id
     WHERE j.id = ${jobId} AND e.status='VERIFIED' AND j.pending_changes IS NULL AND (j.expires_at IS NULL OR j.expires_at>${at})
  `;
  // JOB-05 — a job that is not live must never generate an alert.
  if (!job || job.status !== 'LIVE') {
    return { candidatesAlerted: 0, partnersAlerted: 0, suppressed: [] };
  }

  // ---- candidates ---------------------------------------------------------
  const candidates = await sql<{
    id: string; language: string; locality_key: string | null; status: string;
    max_commute_min: number; alert_quiet_from: number; alert_quiet_to: number;
    alert_max_per_week: number; alerts_this_week: string; already: string;
    alerts_consent: boolean; languages: string[];
  }[]>`
    SELECT c.id, c.language, c.locality_key, c.status, c.max_commute_min,
           c.alert_quiet_from, c.alert_quiet_to, c.alert_max_per_week, c.languages,
           COALESCE((SELECT cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL
                       FROM app.consent_record cr
                      WHERE cr.candidate_id = c.id AND cr.purpose = 'JOB_ALERTS'), FALSE) AS alerts_consent,
           (SELECT COUNT(*)::text FROM app.job_alert a
             WHERE a.candidate_id = c.id AND a.sent_at > ${at}::timestamptz - interval '7 days') AS alerts_this_week,
           (SELECT COUNT(*)::text FROM app.job_alert a
             WHERE a.candidate_id = c.id AND a.job_id = ${jobId}) AS already
      FROM app.candidate c
     WHERE c.status = 'PROFILE_ACTIVE'
  `;

  const hour = istHour(at);
  const provider = messagingProvider();
  const travel = travelProvider();
  let candidatesAlerted = 0;

  for (const c of candidates) {
    if (Number(c.already) > 0) { suppressed.push({ candidateId: c.id, reason: 'ALREADY_ALERTED' }); continue; }
    if (!c.alerts_consent) { suppressed.push({ candidateId: c.id, reason: 'NO_ALERT_CONSENT' }); continue; }
    if (inQuietHours(hour, c.alert_quiet_from, c.alert_quiet_to)) {
      suppressed.push({ candidateId: c.id, reason: 'QUIET_HOURS' }); continue;
    }
    if (Number(c.alerts_this_week) >= c.alert_max_per_week) {
      suppressed.push({ candidateId: c.id, reason: 'WEEKLY_CAP_REACHED' }); continue;
    }
    // ALT-01 — eligibility filtering, so an alert is not simply a broadcast.
    if (job.languages.length && !job.languages.some((l) => c.languages.includes(l))) {
      suppressed.push({ candidateId: c.id, reason: 'NO_REQUIRED_LANGUAGE' }); continue;
    }
    let minutes = 0;
    if (c.locality_key) {
      const est = await travel.between(c.locality_key, job.lat, job.lng);
      minutes = est.minutes;
      if (minutes > c.max_commute_min) {
        suppressed.push({ candidateId: c.id, reason: 'BEYOND_COMMUTE_LIMIT' }); continue;
      }
    }

    await provider.send({
      candidateId: c.id, templateKey: 'job_alert', language: c.language,
      variables: {
        employer: job.brand, title: job.title, locality: job.loc_name,
        fixed: formatINR(Number(job.fixed_pay_paise)), minutes: String(minutes),
      },
    });
    await sql`
      INSERT INTO app.job_alert (id, job_id, candidate_id, language, template_key, sent_at)
      VALUES (${await nextId('ALR')}, ${jobId}, ${c.id}, ${c.language}, 'job_alert', ${at})
      ON CONFLICT (job_id, candidate_id) DO NOTHING
    `;
    candidatesAlerted++;
  }

  // ---- partners (ALT-03) --------------------------------------------------
  const capability = `${job.industry_key}/${job.role_family_key}`;
  const partners = await sql<{ id: string }[]>`
    SELECT p.id FROM app.partner p
     WHERE p.status = 'VERIFIED'
       AND jsonb_exists(p.capabilities, ${capability})
       AND EXISTS (SELECT 1 FROM app.partner_site s
                    WHERE s.partner_id = p.id AND s.status = 'ACTIVE')
  `;
  let partnersAlerted = 0;
  for (const p of partners) {
    const r = await sql`
      INSERT INTO app.partner_job_alert (id, job_id, partner_id, bounty_paise, sent_at)
      VALUES (${await nextId('PJA')}, ${jobId}, ${p.id}, ${policy.partnerRewardPaise}, ${at})
      ON CONFLICT (job_id, partner_id) DO NOTHING
      RETURNING id
    `;
    if (r.length) partnersAlerted++;
  }

  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, 'SYSTEM', 'PLATFORM', 'JOB_ALERTS_DISPATCHED', 'job', ${jobId},
            'ALT-01/02/03', ${sql.json({ candidatesAlerted, partnersAlerted, suppressed } as never)}, ${at})
  `;
  return { candidatesAlerted, partnersAlerted, suppressed };
}

/** ALT-04 — the candidate acts straight from the alert. */
export async function respondToAlert(
  alertId: string,
  response: 'VIEW' | 'APPLY' | 'NOT_INTERESTED' | 'STOP_ALERTS' | 'CHANGE_PREFERENCES',
) {
  const at = await now();
  await sql`
    UPDATE app.job_alert SET response = ${response}, responded_at = ${at} WHERE id = ${alertId}
  `;
  if (response === 'STOP_ALERTS') {
    const [a] = await sql<{ candidate_id: string }[]>`
      SELECT candidate_id FROM app.job_alert WHERE id = ${alertId}
    `;
    await sql`
      UPDATE app.consent_record SET withdrawn_at = ${at}
       WHERE candidate_id = ${a.candidate_id} AND purpose = 'JOB_ALERTS'
    `;
    await messagingProvider().send({
      candidateId: a.candidate_id, templateKey: 'opt_out', language: 'en',
    });
  }
}

/**
 * ALT-05/06 — a partner may nudge a candidate they sourced, but only one the
 * candidate consented to be assisted by, only through a platform-controlled
 * template, and only within a rate limit. A partner can never compose the
 * message, so misleading salary claims and job guarantees are impossible.
 */
export const NUDGE_LIMIT_PER_WEEK = 2;

export async function sendNudge(partnerId: string, candidateId: string, jobId: string) {
  const at = await now();

  const [attr] = await sql<{ partner_id: string | null }[]>`
    SELECT partner_id FROM app.attribution WHERE candidate_id = ${candidateId}
  `;
  if (attr?.partner_id !== partnerId) return { error: 'NOT_YOUR_CANDIDATE' };

  const [consent] = await sql<{ ok: boolean }[]>`
    SELECT (granted_at IS NOT NULL AND withdrawn_at IS NULL) AS ok
      FROM app.consent_record
     WHERE candidate_id = ${candidateId} AND purpose = 'PARTNER_ASSISTANCE'
  `;
  if (!consent?.ok) return { error: 'NO_ASSISTANCE_CONSENT' };

  const [count] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.partner_nudge
     WHERE candidate_id = ${candidateId}
       AND created_at > ${at}::timestamptz - interval '7 days'
  `;
  if (Number(count.n) >= NUDGE_LIMIT_PER_WEEK) return { error: 'NUDGE_RATE_LIMIT' };

  const id = await nextId('NDG');
  await sql`
    INSERT INTO app.partner_nudge
      (id, partner_id, candidate_id, job_id, template_key, delivered_at, created_at)
    VALUES (${id}, ${partnerId}, ${candidateId}, ${jobId}, 'reconfirm_interest', ${at}, ${at})
  `;
  const [job] = await sql<{ title: string; brand: string }[]>`
    SELECT j.title, e.brand_name AS brand FROM app.job j
      JOIN app.employer_organisation e ON e.id = j.employer_id WHERE j.id = ${jobId} AND e.status='VERIFIED' AND j.pending_changes IS NULL AND (j.expires_at IS NULL OR j.expires_at>${at})
  `;
  await messagingProvider().send({
    candidateId, templateKey: 'reconfirm_interest', language: 'en',
    variables: { employer: job.brand, title: job.title },
  });
  return { nudgeId: id };
}

/** LEAD-12 — tell the employer when new profiles qualify while a job is live. */
export async function newlyQualifiedSince(jobId: string, since: Date) {
  const rows = await sql<{ candidate_id: string; score: number; computed_at: Date }[]>`
    SELECT m.candidate_id, m.score, m.computed_at
      FROM app.match_result m
      JOIN app.application a ON a.id = m.application_id
     WHERE m.job_id = ${jobId} AND m.qualified = TRUE
       AND a.reconfirmed_at IS NOT NULL
       AND m.computed_at > ${since}
       AND NOT EXISTS (SELECT 1 FROM app.qualified_lead_unlock u
                        WHERE u.job_id = m.job_id AND u.candidate_id = m.candidate_id)
     ORDER BY m.score DESC
  `;
  return rows;
}
