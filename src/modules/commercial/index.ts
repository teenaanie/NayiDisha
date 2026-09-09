import { sql } from '@/lib/db';
import { now, addHours, financialYear } from '@/lib/clock';
import { nextId, unlockIdempotencyKey } from '@/lib/ids';
import { activeCommercialPolicy } from '@/modules/configuration';
import { getRoleConfig } from '@/modules/configuration';
import { tdsRateBp, applyTds, TDS_THRESHOLD_PAISE } from '@/lib/money';
import { payoutProvider } from '@/modules/adapters/payout';

/**
 * Commercial loop and ledgers (§8.8, §8.11, §9).
 *
 * Two append-only ledgers — credits and rewards. Corrections are new linked
 * rows; nothing is ever UPDATEd or deleted (REF-08). The internal ledger is
 * the source of truth and a payment provider is only an execution channel
 * (§24.2), which is why a payout row exists before any provider is called and
 * survives if the provider fails.
 */

export interface UnlockOutcome {
  status: 'CREATED' | 'ALREADY_UNLOCKED' | 'BLOCKED';
  unlockId?: string;
  reason?: string;
  revealed?: Record<string, unknown>;
}

/**
 * LEAD-04/05/07 — unlock a qualified profile.
 *
 * Idempotent on (employer, job, candidate). A refresh, a re-post, a second
 * authorised user opening the same profile, or a replayed webhook all return
 * the existing unlock and consume nothing further — a §25 acceptance criterion.
 *
 * Everything happens in one transaction: credit consumption, the unlock event
 * and the partner reward accrual either all land or none do.
 */
export async function unlockQualifiedProfile(
  employerId: string, jobId: string, candidateId: string, actor: string,
): Promise<UnlockOutcome> {
  const policy = await activeCommercialPolicy();
  const at = await now();
  const key = unlockIdempotencyKey(employerId, jobId, candidateId);

  const [existing] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM app.qualified_lead_unlock WHERE idempotency_key = ${key}
  `;
  if (existing && existing.status === 'CONFIRMED') {
    return { status: 'ALREADY_UNLOCKED', unlockId: existing.id,
             revealed: await revealedProfile(candidateId, jobId) };
  }

  return sql.begin(async (tx) => {
    // The candidate must be a Qualified Profile with reconfirmed interest (LEAD-03).
    const [m] = await tx<{
      id: string; application_id: string; qualified: boolean; reconfirmed_at: Date | null;
      app_status: string; role_config_id: string;
    }[]>`
      SELECT m.id, m.application_id, m.qualified, a.reconfirmed_at, a.status AS app_status,
             m.role_config_id
        FROM app.match_result m
        JOIN app.application a ON a.id = m.application_id
       WHERE m.candidate_id = ${candidateId} AND m.job_id = ${jobId}
       ORDER BY m.computed_at DESC LIMIT 1
    `;
    if (!m || !m.qualified) return { status: 'BLOCKED', reason: 'NOT_A_QUALIFIED_PROFILE' } as UnlockOutcome;
    if (!m.reconfirmed_at) return { status: 'BLOCKED', reason: 'INTEREST_NOT_RECONFIRMED' } as UnlockOutcome;
    if (['WITHDRAWN', 'REJECTED'].includes(m.app_status)) {
      return { status: 'BLOCKED', reason: 'CANDIDATE_UNAVAILABLE' } as UnlockOutcome;
    }

    // Processing consent must still stand at the moment of reveal.
    const [consent] = await tx<{ withdrawn_at: Date | null }[]>`
      SELECT withdrawn_at FROM app.consent_record
       WHERE candidate_id = ${candidateId} AND purpose = 'PROCESSING'
    `;
    if (!consent || consent.withdrawn_at) {
      return { status: 'BLOCKED', reason: 'CONSENT_WITHDRAWN' } as UnlockOutcome;
    }

    const [ent] = await tx<{
      id: string; credits_included: number; credits_purchased: number;
      max_distinct_unlocks: number; ends_at: Date; credit_expiry_at: Date;
    }[]>`SELECT * FROM app.posting_entitlement WHERE job_id = ${jobId}`;
    if (!ent) return { status: 'BLOCKED', reason: 'NO_POSTING_ENTITLEMENT' } as UnlockOutcome;
    if (ent.credit_expiry_at <= at) return { status: 'BLOCKED', reason: 'CREDITS_EXPIRED' } as UnlockOutcome;

    const bal = await creditBalance(ent.id, tx);
    if (bal.available <= 0) return { status: 'BLOCKED', reason: 'NO_CREDITS_REMAINING' } as UnlockOutcome;
    if (bal.consumed >= ent.max_distinct_unlocks) {
      return { status: 'BLOCKED', reason: 'UNLOCK_CEILING_REACHED' } as UnlockOutcome;
    }

    // S-09: snapshot the attribution onto the unlock. The reward ledger must
    // never re-derive candidate -> site -> partner at payout time.
    const [attr] = await tx<{
      partner_id: string | null; partner_site_id: string | null; method: string;
      status: string; expires_at: Date; bound_at: Date;
    }[]>`SELECT * FROM app.attribution WHERE candidate_id = ${candidateId}`;

    const attributionValid =
      !!attr && attr.status === 'ACTIVE' && !!attr.partner_id && attr.expires_at > at;

    const cfg = await getRoleConfig(m.role_config_id, tx);
    const unlockId = await nextId('UNL', tx);
    const revealed = await revealedProfile(candidateId, jobId, cfg.unlockFields, tx);

    await tx`
      INSERT INTO app.qualified_lead_unlock (
        id, employer_id, job_id, candidate_id, application_id, match_result_id,
        idempotency_key, price_paise, paid_with, consent_snapshot, revealed_fields,
        attributed_partner_id, attributed_site_id, attribution_snapshot,
        status, unlocked_by, unlocked_at
      ) VALUES (
        ${unlockId}, ${employerId}, ${jobId}, ${candidateId}, ${m.application_id}, ${m.id},
        ${key}, ${policy.additionalCreditPaise},
        ${bal.includedRemaining > 0 ? 'INCLUDED_CREDIT' : 'PURCHASED_CREDIT'},
        ${sql.json({ processing: 'GRANTED', capturedAt: at } as never)},
        ${sql.json(cfg.unlockFields as never)},
        ${attributionValid ? attr!.partner_id : null},
        ${attributionValid ? attr!.partner_site_id : null},
        ${sql.json({
          method: attr?.method ?? 'DIRECT',
          status: attr?.status ?? 'NONE',
          boundAt: attr?.bound_at ?? null,
          valid: attributionValid,
        } as never)},
        'CONFIRMED', ${actor}, ${at}
      )
    `;

    const creditId = await nextId('CRD', tx);
    await tx`
      INSERT INTO app.credit_ledger
        (id, entitlement_id, entry_type, credit_delta, amount_paise, unlock_id, note, created_at)
      VALUES (${creditId}, ${ent.id}, 'UNLOCK_CONSUME', -1, 0, ${unlockId},
              ${'Unlock ' + candidateId + ' for ' + jobId}, ${at})
    `;

    await tx`
      UPDATE app.application SET status = 'UNLOCKED', status_at = ${at}
       WHERE id = ${m.application_id}
    `;

    // REF-05 — reward becomes eligible after the fraud hold, independent of
    // interview, joining or retention.
    if (attributionValid) {
      const rewardId = await nextId('RWD', tx);
      await tx`
        INSERT INTO app.reward_ledger
          (id, partner_id, unlock_id, entry_type, amount_paise, status, hold_until, fy_label, note, created_at)
        VALUES (${rewardId}, ${attr!.partner_id}, ${unlockId}, 'ACCRUAL',
                ${policy.partnerRewardPaise}, 'IN_HOLD',
                ${addHours(at, policy.partnerRewardHoldHours)},
                ${financialYear(at)}, 'Valid attributed qualified-profile unlock', ${at})
      `;
    }

    await tx`
      INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
      VALUES (${await nextId('AUD', tx)}, ${actor}, 'EMPLOYER', 'PROFILE_UNLOCKED',
              'qualified_lead_unlock', ${unlockId}, 'LEAD-05',
              ${sql.json({ jobId, candidateId, attributionValid } as never)}, ${at})
    `;

    return { status: 'CREATED', unlockId, revealed } as UnlockOutcome;
  });
}

async function revealedProfile(
  candidateId: string, jobId: string, fields?: string[], conn = sql,
): Promise<Record<string, unknown>> {
  const [c] = await conn<{
    id: string; name: string; phone: string; locality_key: string;
    experience_months: number; experience_tags: string[]; languages: string[];
    expected_pay_paise: string; current_pay_paise: string | null;
  }[]>`SELECT * FROM app.candidate WHERE id = ${candidateId}`;
  const full: Record<string, unknown> = {
    name: c.name, phone: c.phone, locality: c.locality_key,
    experienceMonths: c.experience_months, experienceTags: c.experience_tags,
    languages: c.languages, expectedPayPaise: Number(c.expected_pay_paise),
    currentPayPaise: c.current_pay_paise === null ? null : Number(c.current_pay_paise),
  };
  if (!fields || fields.length === 0) return full;
  return Object.fromEntries(Object.entries(full).filter(([k]) => fields.includes(k)));
}

export async function creditBalance(entitlementId: string, tx = sql) {
  const rows = await tx<{ entry_type: string; credit_delta: number }[]>`
    SELECT entry_type, credit_delta FROM app.credit_ledger
     WHERE entitlement_id = ${entitlementId} ORDER BY created_at
  `;
  let granted = 0, purchased = 0, consumed = 0, restored = 0, expired = 0;
  for (const r of rows) {
    if (r.entry_type === 'INCLUDED_GRANT') granted += r.credit_delta;
    else if (r.entry_type === 'PURCHASE') purchased += r.credit_delta;
    else if (r.entry_type === 'UNLOCK_CONSUME') consumed += -r.credit_delta;
    else if (r.entry_type === 'REPLACEMENT_RESTORE') restored += r.credit_delta;
    else if (r.entry_type === 'EXPIRY') expired += -r.credit_delta;
  }
  const available = granted + purchased + restored - consumed - expired;
  return {
    granted, purchased, consumed, restored, expired, available,
    includedRemaining: Math.max(granted - consumed, 0),
  };
}

/**
 * LEAD-08/09 — invalid-lead replacement inside the claim window.
 * Approval restores the employer credit and reverses the partner reward
 * through linked correction rows. "Candidate did not pass our interview" is
 * not an accepted reason (§9.3).
 */
export async function raiseReplacement(
  unlockId: string, reasonCode: 'INVALID_CONTACT' | 'NEVER_APPLIED' | 'DUPLICATE_PROFILE',
  evidence: string,
): Promise<{ id: string } | { error: string }> {
  const policy = await activeCommercialPolicy();
  const at = await now();
  const [u] = await sql<{ unlocked_at: Date; status: string }[]>`
    SELECT unlocked_at, status FROM app.qualified_lead_unlock WHERE id = ${unlockId}
  `;
  if (!u) return { error: 'UNLOCK_NOT_FOUND' };
  if (u.status !== 'CONFIRMED') return { error: 'UNLOCK_ALREADY_REPLACED' };
  const windowEnds = addHours(u.unlocked_at, policy.replacementWindowHours);
  if (at > windowEnds) return { error: 'CLAIM_WINDOW_CLOSED' };

  const id = await nextId('RPL');
  await sql`
    INSERT INTO app.replacement_case
      (id, unlock_id, reason_code, evidence, decision, raised_at, window_ends_at)
    VALUES (${id}, ${unlockId}, ${reasonCode}, ${evidence}, 'PENDING', ${at}, ${windowEnds})
  `;
  return { id };
}

export async function decideReplacement(
  caseId: string, decision: 'APPROVED' | 'REJECTED', actor: string,
): Promise<void> {
  const at = await now();
  await sql.begin(async (tx) => {
    const [c] = await tx<{ unlock_id: string; decision: string }[]>`
      SELECT unlock_id, decision FROM app.replacement_case WHERE id = ${caseId}
    `;
    if (!c || c.decision !== 'PENDING') throw new Error('Replacement case not pending');

    await tx`
      UPDATE app.replacement_case
         SET decision = ${decision}, decided_by = ${actor}, decided_at = ${at}
       WHERE id = ${caseId}
    `;
    if (decision !== 'APPROVED') return;

    const [u] = await tx<{
      id: string; job_id: string; attributed_partner_id: string | null; application_id: string;
    }[]>`SELECT * FROM app.qualified_lead_unlock WHERE id = ${c.unlock_id}`;
    const [ent] = await tx<{ id: string }[]>`
      SELECT id FROM app.posting_entitlement WHERE job_id = ${u.job_id}
    `;
    const [consumeEntry] = await tx<{ id: string }[]>`
      SELECT id FROM app.credit_ledger WHERE unlock_id = ${u.id} AND entry_type = 'UNLOCK_CONSUME'
    `;

    // Mark the unlock replaced rather than deleting it — LEAD-09 correction chain.
    await tx`UPDATE app.qualified_lead_unlock SET status = 'REPLACED' WHERE id = ${u.id}`;

    await tx`
      INSERT INTO app.credit_ledger
        (id, entitlement_id, entry_type, credit_delta, amount_paise, unlock_id, linked_entry_id, note, created_at)
      VALUES (${await nextId('CRD', tx)}, ${ent.id}, 'REPLACEMENT_RESTORE', 1, 0, ${u.id},
              ${consumeEntry?.id ?? null}, ${'Replacement ' + caseId + ' approved'}, ${at})
    `;

    if (u.attributed_partner_id) {
      const [accrual] = await tx<{ id: string; amount_paise: string; status: string }[]>`
        SELECT id, amount_paise, status FROM app.reward_ledger
         WHERE unlock_id = ${u.id} AND entry_type = 'ACCRUAL'
      `;
      if (accrual) {
        await tx`
          INSERT INTO app.reward_ledger
            (id, partner_id, unlock_id, entry_type, amount_paise, status, linked_entry_id, fy_label, note, created_at)
          VALUES (${await nextId('RWD', tx)}, ${u.attributed_partner_id}, ${u.id}, 'REVERSAL',
                  ${-Number(accrual.amount_paise)}, 'REVERSED', ${accrual.id},
                  ${financialYear(at)}, ${'Reversed by replacement ' + caseId}, ${at})
        `;
        // The original accrual row is never mutated except to mark it settled.
        await tx`UPDATE app.reward_ledger SET status = 'REVERSED' WHERE id = ${accrual.id}`;
      }
    }

    await tx`
      INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
      VALUES (${await nextId('AUD', tx)}, ${actor}, 'OPERATIONS', 'REPLACEMENT_APPROVED',
              'replacement_case', ${caseId}, 'LEAD-09',
              ${sql.json({ unlockId: u.id } as never)}, ${at})
    `;
  });
}

/** REF-05 — holds that have matured become eligible. Run on demand or by schedule. */
export async function releaseMaturedHolds(): Promise<number> {
  const at = await now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.reward_ledger
       SET status = 'ELIGIBLE'
     WHERE status = 'IN_HOLD' AND hold_until <= ${at}
     RETURNING id
  `;
  return rows.length;
}

export interface PartnerRewardSummary {
  partnerId: string; partnerName: string; hasPan: boolean; upi: string | null;
  inHoldPaise: number; eligiblePaise: number; paidPaise: number; reversedPaise: number;
  fyCumulativePaise: number; counts: Record<string, number>;
}

export async function partnerRewardSummary(partnerId?: string): Promise<PartnerRewardSummary[]> {
  const at = await now();
  const fy = financialYear(at);
  const rows = await sql<{
    partner_id: string; name: string; pan: string | null; payout_upi: string | null;
    status: string; entry_type: string; amount_paise: string; fy_label: string; n: string;
  }[]>`
    SELECT p.id AS partner_id, p.name, p.pan, p.payout_upi,
           r.status, r.entry_type, SUM(r.amount_paise)::text AS amount_paise,
           r.fy_label, COUNT(*)::text AS n
      FROM app.partner p
      LEFT JOIN app.reward_ledger r ON r.partner_id = p.id
     ${partnerId ? sql`WHERE p.id = ${partnerId}` : sql``}
     GROUP BY p.id, p.name, p.pan, p.payout_upi, r.status, r.entry_type, r.fy_label
     ORDER BY p.id
  `;
  const byPartner = new Map<string, PartnerRewardSummary>();
  for (const r of rows) {
    if (!byPartner.has(r.partner_id)) {
      byPartner.set(r.partner_id, {
        partnerId: r.partner_id, partnerName: r.name, hasPan: !!r.pan, upi: r.payout_upi,
        inHoldPaise: 0, eligiblePaise: 0, paidPaise: 0, reversedPaise: 0,
        fyCumulativePaise: 0, counts: {},
      });
    }
    const s = byPartner.get(r.partner_id)!;
    if (!r.status) continue;
    const amt = Number(r.amount_paise ?? 0);
    if (r.status === 'IN_HOLD') s.inHoldPaise += amt;
    if (r.status === 'ELIGIBLE' || r.status === 'APPROVED') s.eligiblePaise += amt;
    if (r.status === 'PAID') { s.paidPaise += amt; if (r.fy_label === fy) s.fyCumulativePaise += amt; }
    if (r.status === 'REVERSED' && r.entry_type === 'REVERSAL') s.reversedPaise += Math.abs(amt);
    s.counts[r.status] = (s.counts[r.status] ?? 0) + Number(r.n);
  }
  return [...byPartner.values()];
}

/**
 * REF-09/10 — weekly payout batch with s.194H withholding.
 * Partners below the payout minimum carry forward rather than being paid.
 */
export async function buildPayoutBatch(actor: string): Promise<{
  created: string[]; skipped: { partnerId: string; reason: string; balancePaise: number }[];
}> {
  const policy = await activeCommercialPolicy();
  const at = await now();
  const summaries = await partnerRewardSummary();
  const created: string[] = [];
  const skipped: { partnerId: string; reason: string; balancePaise: number }[] = [];
  const batchKey = `${policy.payoutCadence}-${at.toISOString().slice(0, 10)}`;

  for (const s of summaries) {
    if (s.eligiblePaise <= 0) continue;
    if (s.eligiblePaise < policy.partnerPayoutMinimumPaise) {
      skipped.push({ partnerId: s.partnerId, reason: 'BELOW_PAYOUT_MINIMUM', balancePaise: s.eligiblePaise });
      continue;
    }
    if (!s.upi) {
      skipped.push({ partnerId: s.partnerId, reason: 'NO_PAYOUT_INSTRUMENT', balancePaise: s.eligiblePaise });
      continue;
    }
    const rateBp = tdsRateBp(s.hasPan, s.fyCumulativePaise + s.eligiblePaise);
    const { tds, net } = applyTds(s.eligiblePaise, rateBp);
    const payoutId = await nextId('PAY');
    await sql`
      INSERT INTO app.payout
        (id, partner_id, gross_paise, tds_paise, tds_rate_bp, net_paise, batch_key, status, created_at)
      VALUES (${payoutId}, ${s.partnerId}, ${s.eligiblePaise}, ${tds}, ${rateBp}, ${net},
              ${batchKey}, 'PENDING_APPROVAL', ${at})
    `;
    await sql`
      UPDATE app.reward_ledger SET status = 'APPROVED', payout_id = ${payoutId}
       WHERE partner_id = ${s.partnerId} AND status = 'ELIGIBLE'
    `;
    created.push(payoutId);
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, ${actor}, 'FINANCE', 'PAYOUT_BATCH_BUILT', 'payout', ${batchKey},
            'REF-10', ${sql.json({ created, skipped } as never)}, ${at})
  `;
  return { created, skipped };
}

export async function approveAndExecutePayout(payoutId: string, actor: string) {
  const at = await now();
  const [p] = await sql<{
    id: string; partner_id: string; net_paise: string; status: string;
  }[]>`SELECT * FROM app.payout WHERE id = ${payoutId}`;
  if (!p || p.status !== 'PENDING_APPROVAL') return { error: 'NOT_PENDING' };

  const [partner] = await sql<{ payout_upi: string | null }[]>`
    SELECT payout_upi FROM app.partner WHERE id = ${p.partner_id}
  `;
  const result = await payoutProvider().execute({
    payoutId: p.id, partnerId: p.partner_id,
    upiVpa: partner.payout_upi, netPaise: Number(p.net_paise),
  });

  await sql`
    UPDATE app.payout
       SET status = ${result.ok ? 'SIMULATED_PAID' : 'FAILED'},
           provider_ref = ${result.providerRef}, approved_by = ${actor},
           paid_at = ${result.ok ? at : null}
     WHERE id = ${payoutId}
  `;
  if (result.ok) {
    await sql`
      UPDATE app.reward_ledger SET status = 'PAID', entry_type = 'PAYOUT'
       WHERE payout_id = ${payoutId} AND status = 'APPROVED'
    `;
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, ${actor}, 'FINANCE', 'PAYOUT_EXECUTED', 'payout', ${payoutId},
            'REF-09', ${sql.json(result as never)}, ${at})
  `;
  return result;
}

/**
 * §25 — every commercial event must reconcile:
 *   opening + credits − unlocks ± adjustments = closing
 */
export async function reconcileEntitlement(entitlementId: string) {
  const b = await creditBalance(entitlementId);
  const [unlockCount] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n
      FROM app.qualified_lead_unlock u
      JOIN app.posting_entitlement e ON e.job_id = u.job_id
     WHERE e.id = ${entitlementId} AND u.status = 'CONFIRMED'
  `;
  const closing = b.granted + b.purchased + b.restored - b.consumed - b.expired;
  return {
    opening: 0,
    granted: b.granted, purchased: b.purchased,
    unlocks: b.consumed, adjustments: b.restored - b.expired,
    closing, available: b.available,
    confirmedUnlocks: Number(unlockCount.n),
    balances: closing === b.available,
    unlocksMatchLedger: Number(unlockCount.n) === b.consumed - b.restored,
  };
}

export { TDS_THRESHOLD_PAISE };
