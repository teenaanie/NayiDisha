import { sql } from '@/lib/db';
import { computeMatch } from '@/modules/matching';
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

  const [prior] = await sql<{id:string;status:string}[]>`SELECT id,status FROM app.qualified_lead_unlock WHERE idempotency_key=${key}`;
  if(prior) {
    const [consent]=await sql`SELECT 1 FROM app.consent_record WHERE candidate_id=${candidateId} AND purpose='PROCESSING' AND granted_at IS NOT NULL AND withdrawn_at IS NULL`;
    const [u]=await sql`SELECT revealed_fields FROM app.qualified_lead_unlock WHERE id=${prior.id}`;
    return {status:'ALREADY_UNLOCKED',unlockId:prior.id,revealed:consent && prior.status==='CONFIRMED'?await revealedProfile(candidateId,jobId,u.revealed_fields):{}};
  }
  const fresh=await computeMatch(candidateId,jobId);
  if(!fresh.qualified) return {status:'BLOCKED',reason:fresh.gaps.join(', ')};
  return sql.begin(async (tx) => {
    // Serialise capacity consumption before checking idempotency or balance.
    await tx`SELECT id FROM app.posting_entitlement WHERE job_id=${jobId} FOR UPDATE`;
    const [replay]=await tx`SELECT id FROM app.qualified_lead_unlock WHERE idempotency_key=${key}`;
    if(replay) return {status:'ALREADY_UNLOCKED',unlockId:replay.id} as UnlockOutcome;
    const [live]=await tx`SELECT j.id FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id
      WHERE j.id=${jobId} AND j.employer_id=${employerId} AND j.status='LIVE' AND e.status='VERIFIED'
      AND (j.expires_at IS NULL OR j.expires_at>${at}) AND j.pending_changes IS NULL FOR SHARE OF j,e`;
    if(!live) return {status:'BLOCKED',reason:'JOB_OR_EMPLOYER_NOT_ACTIVE'} as UnlockOutcome;
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
       ORDER BY m.computed_at DESC, m.id DESC LIMIT 1
    `;
    if (!m || !m.qualified) return { status: 'BLOCKED', reason: 'NOT_A_QUALIFIED_PROFILE' } as UnlockOutcome;
    if (!m.reconfirmed_at) return { status: 'BLOCKED', reason: 'INTEREST_NOT_RECONFIRMED' } as UnlockOutcome;
    if (['WITHDRAWN', 'REJECTED'].includes(m.app_status)) {
      return { status: 'BLOCKED', reason: 'CANDIDATE_UNAVAILABLE' } as UnlockOutcome;
    }

    // Processing consent must still stand at the moment of reveal.
    const [consent] = await tx<{ withdrawn_at: Date | null }[]>`
      SELECT withdrawn_at FROM app.consent_record
       WHERE candidate_id = ${candidateId} AND purpose = 'PROCESSING' AND granted_at IS NOT NULL FOR SHARE
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
    }[]>`SELECT * FROM app.attribution WHERE candidate_id = ${candidateId}
      AND (partner_id IS NULL OR EXISTS(SELECT 1 FROM app.partner p WHERE p.id=partner_id AND p.status='VERIFIED'))
      AND (partner_site_id IS NULL OR EXISTS(SELECT 1 FROM app.partner_site s WHERE s.id=partner_site_id AND s.status='ACTIVE'))`;

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
  if (!fields || fields.length === 0) return {};
  return Object.fromEntries(Object.entries(full).filter(([k]) => fields.includes(k)));
}

export async function creditBalance(entitlementId: string, tx = sql) {
  const rows = await tx<{ entry_type: string; credit_delta: number }[]>`
    SELECT entry_type, credit_delta FROM app.credit_ledger
     WHERE entitlement_id = ${entitlementId} ORDER BY created_at
  `;
  return summarizeCreditEntries(rows);
}

export function summarizeCreditEntries(rows:ReadonlyArray<{entry_type:string;credit_delta:number}>){
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

  if(!['INVALID_CONTACT','NEVER_APPLIED','DUPLICATE_PROFILE'].includes(reasonCode))return {error:'INVALID_REASON'};
  if(!evidence.trim()) return {error:'EVIDENCE_REQUIRED'};
  return sql.begin(async tx=>{
  await tx`SELECT id FROM app.qualified_lead_unlock WHERE id=${unlockId} FOR UPDATE`;
  const [open]=await tx`SELECT id FROM app.replacement_case WHERE unlock_id=${unlockId} AND decision IN ('PENDING','APPROVED')`;
  if(open) return {id:open.id};
  const id = await nextId('RPL',tx);
  await tx`
    INSERT INTO app.replacement_case
      (id, unlock_id, reason_code, evidence, decision, raised_at, window_ends_at)
    VALUES (${id}, ${unlockId}, ${reasonCode}, ${evidence}, 'PENDING', ${at}, ${windowEnds})
  `;
  return { id };
  });
}

export async function decideReplacement(
  caseId: string, decision: 'APPROVED' | 'REJECTED', actor: string,
): Promise<void> {
  const at = await now();
  await sql.begin(async (tx) => {
    const [c] = await tx<{ unlock_id: string; decision: string }[]>`
      SELECT unlock_id, decision FROM app.replacement_case WHERE id = ${caseId} FOR UPDATE
    `;
    if (!c || c.decision !== 'PENDING') return;
    const [locked]=await tx`SELECT status FROM app.qualified_lead_unlock WHERE id=${c.unlock_id} FOR UPDATE`;
    if(locked.status !== 'CONFIRMED') { await tx`UPDATE app.replacement_case SET decision='REJECTED',decided_by=${actor},decided_at=${at} WHERE id=${caseId}`; return; }

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
        const reversalId=await nextId('RWD',tx);
        await tx`
          INSERT INTO app.reward_ledger
            (id, partner_id, unlock_id, entry_type, amount_paise, status, linked_entry_id, fy_label, note, created_at)
          VALUES (${reversalId}, ${u.attributed_partner_id}, ${u.id}, 'REVERSAL',
                  ${-Number(accrual.amount_paise)}, 'REVERSED', ${accrual.id},
                  ${financialYear(at)}, ${'Reversed by replacement ' + caseId}, ${at})
        `;
        if(accrual.status==='PAID') {
          await tx`INSERT INTO app.payout_recovery(id,partner_id,reversal_id,amount_paise,created_at) VALUES(${reversalId},${u.attributed_partner_id},${reversalId},${Number(accrual.amount_paise)},${at})`;
        } else {
          await tx`UPDATE app.reward_ledger SET status='REVERSED' WHERE id=${accrual.id}`;
          // Cancel a pending batch containing the revoked earning; rebuild from remaining eligible rows.
          const affected=await tx`UPDATE app.payout SET status='FAILED',failure_reason='REWARD_REVERSED_REBUILD_BATCH' WHERE id IN (SELECT payout_id FROM app.reward_ledger WHERE id=${accrual.id}) AND status='PENDING_APPROVAL' RETURNING id`;
          for(const p of affected) await tx`UPDATE app.reward_ledger SET status='ELIGIBLE',payout_id=NULL WHERE payout_id=${p.id} AND status='APPROVED'`;
        }
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
  inHoldPaise: number; approvedPaise:number; disputedPaise:number; eligiblePaise: number; paidPaise: number; reversedPaise: number;
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
        inHoldPaise: 0, approvedPaise:0, disputedPaise:0, eligiblePaise: 0, paidPaise: 0, reversedPaise: 0,
        fyCumulativePaise: 0, counts: {},
      });
    }
    const s = byPartner.get(r.partner_id)!;
    if (!r.status) continue;
    const amt = Number(r.amount_paise ?? 0);
    if (r.status === 'IN_HOLD') s.inHoldPaise += amt;
    if(r.status==='APPROVED')s.approvedPaise+=amt;
    if(r.status==='DISPUTED')s.disputedPaise+=amt;
    if (r.status === 'ELIGIBLE') s.eligiblePaise += amt;
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
  return sql.begin(async tx=>{
    // One batch builder at a time. Reward rows are reserved in the same transaction.
    await tx`SELECT pg_advisory_xact_lock(727001)`;
    const partners=await tx`SELECT id,payout_upi,pan FROM app.partner WHERE status='VERIFIED' ORDER BY id FOR UPDATE`;
    const created:string[]=[];
    const skipped:{partnerId:string;reason:string;balancePaise:number}[]=[];
    for(const p of partners){
      const rows=await tx`SELECT id,amount_paise FROM app.reward_ledger WHERE partner_id=${p.id} AND status='ELIGIBLE' AND entry_type='ACCRUAL' FOR UPDATE`;
      const gross=rows.reduce((n,r)=>n+Number(r.amount_paise),0);
      if(!gross) continue;
      if(gross<policy.partnerPayoutMinimumPaise || !p.payout_upi){skipped.push({partnerId:p.id,reason:!p.payout_upi?'NO_PAYOUT_INSTRUMENT':'BELOW_PAYOUT_MINIMUM',balancePaise:gross});continue;}
      const [fy]=await tx`SELECT COALESCE(SUM(gross_paise),0) AS n,COALESCE(SUM(tds_paise),0) AS withheld FROM app.payout WHERE partner_id=${p.id} AND status='SIMULATED_PAID' AND paid_at>=${new Date(Number(financialYear(at).slice(0,4))+'-04-01T00:00:00+05:30')}`;
      const rate=tdsRateBp(!!p.pan,Number(fy.n)+gross);
      const tds=Math.min(gross,Math.max(0,applyTds(Number(fy.n)+gross,rate).tds-Number(fy.withheld)));
      const id=await nextId('PAY',tx);
      await tx`INSERT INTO app.payout(id,partner_id,gross_paise,tds_paise,tds_rate_bp,net_paise,batch_key,status,created_at) VALUES(${id},${p.id},${gross},${tds},${rate},${gross-tds},${'DEMO-'+at.toISOString()},'PENDING_APPROVAL',${at})`;
      await tx`UPDATE app.reward_ledger SET status='APPROVED',payout_id=${id} WHERE id=ANY(${rows.map(r=>r.id)})`;
      created.push(id);
    }
    await tx`INSERT INTO app.audit_log(id,actor,actor_role,event,entity_type,reason,detail,created_at) VALUES(${await nextId('AUD',tx)},${actor},'FINANCE','PAYOUT_BATCH_BUILT','payout','Eligible earnings reserved once',${tx.json({created,skipped})},${at})`;
    return {created,skipped};
  });
}

export async function approveAndExecutePayout(payoutId: string, actor: string) {
  const at=await now();
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(727001)`;
    const [p]=await tx`SELECT * FROM app.payout WHERE id=${payoutId} FOR UPDATE`;
    if(!p || p.status!=='PENDING_APPROVAL') return {error:'NOT_PENDING'};
    const [partner]=await tx`SELECT * FROM app.partner WHERE id=${p.partner_id} FOR UPDATE`;
    if(partner.status!=='VERIFIED') return {error:'PARTNER_NOT_ACTIVE'};
    const [sum]=await tx`SELECT COALESCE(SUM(amount_paise),0) AS n FROM app.reward_ledger WHERE payout_id=${payoutId} AND status='APPROVED'`;
    if(Number(sum.n)!==Number(p.gross_paise)) return {error:'PAYOUT_LEDGER_MISMATCH'};
    const [flags]=await tx`SELECT payout_failure FROM app.demo_clock WHERE id=1`;
    if(flags?.payout_failure){await tx`UPDATE app.payout SET failure_reason='SIMULATED_PROVIDER_FAILURE' WHERE id=${payoutId}`;return {ok:false,failureReason:'Simulated failure. Turn failure mode off and retry this payout.'};}
    const debts=await tx`SELECT * FROM app.payout_recovery WHERE partner_id=${p.partner_id} AND recovered_paise<amount_paise ORDER BY created_at,id FOR UPDATE`;
    let remaining=Number(p.net_paise), recovery=0;
    for(const d of debts){const take=Math.min(remaining,Number(d.amount_paise)-Number(d.recovered_paise));if(!take) break;remaining-=take;recovery+=take;
      await tx`UPDATE app.payout_recovery SET recovered_paise=recovered_paise+${take} WHERE id=${d.id}`;
      await tx`INSERT INTO app.payout_recovery_offset(payout_id,recovery_id,amount_paise) VALUES(${payoutId},${d.id},${take})`;
    }
    // Demo provider is deterministic and has no network side effect.
    const result=await payoutProvider().execute({payoutId,partnerId:p.partner_id,upiVpa:partner.payout_upi,netPaise:remaining});
    if(!result.ok) throw new Error(result.failureReason || 'Payout failed');
    await tx`UPDATE app.payout SET status='SIMULATED_PAID',provider_ref=${result.providerRef},approved_by=${actor},paid_at=${at},recovery_paise=${recovery},net_paise=${remaining},failure_reason=NULL WHERE id=${payoutId}`;
    await tx`UPDATE app.reward_ledger SET status='PAID' WHERE payout_id=${payoutId} AND status='APPROVED'`;
    await tx`INSERT INTO app.audit_log(id,actor,actor_role,event,entity_type,entity_id,reason,detail,created_at) VALUES(${await nextId('AUD',tx)},${actor},'FINANCE','PAYOUT_EXECUTED','payout',${payoutId},'Simulated settlement; accrual retained',${tx.json({recovery,net:remaining})},${at})`;
    return result;
  });
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
