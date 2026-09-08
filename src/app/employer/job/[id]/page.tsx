import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { formatPay } from '@/lib/money';
import { previewsForJob, maskName } from '@/modules/matching';
import { activeCommercialPolicy } from '@/modules/configuration';
import { creditBalance } from '@/modules/commercial';
import { Clause, Money, StatusPill, ScoreBars, Tags } from '../../../ui';
import { UnlockPanel } from './unlock-panel';

export const dynamic = 'force-dynamic';

export default async function JobShortlist({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const policy = await activeCommercialPolicy();

  const [job] = await sql<{
    id: string; title: string; employer_id: string; brand: string; loc: string;
    fixed_pay_paise: string; variable_max_paise: string; shift: string; openings: number;
    status: string; expires_at: Date | null; role_config_id: string; critical_skills: string[];
  }[]>`
    SELECT j.*, e.brand_name AS brand, l.name AS loc
      FROM app.job j
      JOIN app.employer_organisation e ON e.id=j.employer_id
      JOIN app.employer_location l ON l.id=j.location_id
     WHERE j.id=${jobId}`;
  if (!job) return <main className="page"><h1>Job not found</h1></main>;

  const [ent] = await sql<{ id: string; max_distinct_unlocks: number }[]>`
    SELECT id, max_distinct_unlocks FROM app.posting_entitlement WHERE job_id=${jobId}`;
  const balance = ent ? await creditBalance(ent.id) : null;

  const previews = await previewsForJob(jobId, policy.previewBatchSize);

  const matchDetail = await sql<{
    candidate_id: string; score_components: Record<string, { raw: number; weight: number; weighted: number }>;
    endorsement_points: number; rule_version: string; inputs_snapshot: Record<string, unknown>;
  }[]>`
    SELECT candidate_id, score_components, endorsement_points, rule_version, inputs_snapshot
      FROM app.match_result WHERE job_id=${jobId} AND qualified=TRUE`;
  const detail = new Map(matchDetail.map((m) => [m.candidate_id, m]));

  const unlocks = await sql<{
    id: string; candidate_id: string; unlocked_at: Date; status: string;
    revealed_fields: string[]; attributed_partner_id: string | null; application_id: string;
    name: string; phone: string; locality_key: string; expected_pay_paise: string;
  }[]>`
    SELECT u.*, c.name, c.phone, c.locality_key, c.expected_pay_paise
      FROM app.qualified_lead_unlock u JOIN app.candidate c ON c.id=u.candidate_id
     WHERE u.job_id=${jobId} ORDER BY u.unlocked_at DESC`;

  const notQualified = await sql<{
    candidate_id: string; name: string | null; gaps: string[];
  }[]>`
    SELECT m.candidate_id, c.name, m.gaps FROM app.match_result m
      JOIN app.candidate c ON c.id=m.candidate_id
     WHERE m.job_id=${jobId} AND m.qualified=FALSE`;

  const supplyGap = previews.length < policy.previewBatchSize;

  return (
    <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>{job.title}</h1>
            <div className="sub">
              {job.brand} · {job.loc} · {formatPay(Number(job.fixed_pay_paise), Number(job.variable_max_paise))} ·{' '}
              <span className="mono">{job.shift}</span> · {job.openings} openings
            </div>
          </div>
          <Link className="btn" href="/employer">← All jobs</Link>
        </div>
      </div>

      <div className="card mb">
        <div className="card-body flexb">
          <div className="small">
            <strong>{balance?.available ?? 0}</strong> unlock credits available
            <span className="muted"> of {(balance?.granted ?? 0) + (balance?.purchased ?? 0)} · </span>
            <strong>{balance?.consumed ?? 0}</strong> used
            <span className="muted"> · ceiling {ent?.max_distinct_unlocks ?? '—'} distinct unlocks · each unlock costs </span>
            <Money paise={policy.additionalCreditPaise} />
          </div>
          <Clause>JOB-06 / JOB-07</Clause>
        </div>
      </div>

      {supplyGap && (
        <div className="note warn mb">
          <strong>Supply gap.</strong> {previews.length} qualified {previews.length === 1 ? 'profile' : 'profiles'} available
          against a preview batch of {policy.previewBatchSize}. The shortlist shows the real number —
          qualification criteria are never diluted to fill ten slots. <Clause>LEAD-11</Clause>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Masked qualified-profile previews</h2>
          <Clause>LEAD-01/02/03</Clause>
        </div>
        <div className="card-body tight">
          {previews.length === 0 ? <div className="empty">No qualified profiles yet.</div> : (
            <div className="tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th><th>Locality &amp; travel</th><th>Experience</th>
                    <th>Pay fit</th><th className="num">Score</th><th>Why</th><th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map((p) => {
                    const d = detail.get(p.candidate_id);
                    const inputs = (d?.inputs_snapshot ?? {}) as {
                      travelProvider?: string; configVersion?: string;
                    };
                    const travel = (p.inputs_snapshot as { travelProvider?: string }) ?? {};
                    return (
                      <tr key={p.candidate_id}>
                        <td>
                          <strong>{maskName(p.name)}</strong>
                          <div className="small muted">contact hidden until unlock</div>
                        </td>
                        <td className="small">
                          {p.locality_key?.replace(/_/g, ' ')}
                          <div className="muted mono" style={{ fontSize: '.72rem' }}>
                            {String((p.inputs_snapshot as Record<string, unknown>)?.travelProvider ?? '')}
                          </div>
                        </td>
                        <td className="small">
                          {p.experience_months} months
                          <div style={{ marginTop: 3 }}><Tags items={p.experience_tags} /></div>
                        </td>
                        <td className="small mono">
                          exp <Money paise={p.expected_pay_paise ?? 0} />
                        </td>
                        <td className="num"><strong style={{ fontSize: '1.05rem' }}>{p.score}</strong>
                          {p.endorsement_points > 0 && <div className="small" style={{ color: 'var(--ok)' }}>+{p.endorsement_points} endo</div>}
                        </td>
                        <td>
                          <Tags items={p.explanation} tone="good" />
                          {p.gaps?.length > 0 && <div style={{ marginTop: 4 }}><Tags items={p.gaps} tone="gap" /></div>}
                        </td>
                        <td className="right">
                          <UnlockPanel
                            employerId={job.employer_id} jobId={jobId} candidateId={p.candidate_id}
                            alreadyUnlocked={p.unlocked} pricePaise={policy.additionalCreditPaise}
                            creditsAvailable={balance?.available ?? 0}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {previews.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Score breakdown — top preview</h3><Clause>MATCH-03/06</Clause></div>
          <div className="card-body">
            {(() => {
              const top = previews[0];
              const d = detail.get(top.candidate_id);
              if (!d) return null;
              return (
                <>
                  <div className="flexb mb">
                    <strong>{maskName(top.name)}</strong>
                    <span className="small muted mono">
                      {d.rule_version} · {String((d.inputs_snapshot as { configVersion?: string }).configVersion)}
                    </span>
                  </div>
                  <ScoreBars components={d.score_components} endorsement={d.endorsement_points} />
                  <div className="note small mt">
                    Every ranked result stores the rule version and the exact inputs used, so this
                    breakdown reproduces even after the configuration moves on.
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {unlocks.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Unlocked profiles</h2><Clause>LEAD-05/08</Clause></div>
          <div className="card-body tight">
            <div className="tblwrap">
              <table>
                <thead><tr><th>Unlock</th><th>Candidate</th><th>Contact</th><th>Unlocked</th><th>Status</th><th className="right">Outcome / claim</th></tr></thead>
                <tbody>
                  {unlocks.map((u) => (
                    <tr key={u.id}>
                      <td className="id">{u.id}</td>
                      <td>{u.name}<div className="small muted">{u.locality_key?.replace(/_/g, ' ')}</div></td>
                      <td className="mono small">{u.status === 'CONFIRMED' ? u.phone : <span className="muted">revoked</span>}</td>
                      <td className="small muted">{fmtDateTime(u.unlocked_at)}</td>
                      <td><StatusPill status={u.status} /></td>
                      <td className="right">
                        <UnlockPanel mode="post" unlockId={u.id} applicationId={u.application_id}
                                     employerId={job.employer_id} jobId={jobId} candidateId={u.candidate_id}
                                     alreadyUnlocked disabled={u.status !== 'CONFIRMED'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {notQualified.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Not qualified</h3><Clause>MATCH-10 explainable</Clause></div>
          <div className="card-body tight">
            <div className="tblwrap">
              <table>
                <thead><tr><th>Candidate</th><th>Reasons</th></tr></thead>
                <tbody>
                  {notQualified.map((n) => (
                    <tr key={n.candidate_id}>
                      <td><span className="id">{n.candidate_id}</span> {maskName(n.name)}</td>
                      <td><Tags items={n.gaps} tone="gap" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
