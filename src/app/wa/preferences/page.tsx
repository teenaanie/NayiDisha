import {Extras} from '../extras';
import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { Clause } from '../../ui';
import { SubNav, CANDIDATE_TABS } from '../../subnav';
import { CandidatePicker, PreferencesForm, EndorsementVisibility } from '../candidate-client';
import { resumePoint } from '@/modules/lifecycle';

export const dynamic = 'force-dynamic';

export default async function PreferencesPage({
  searchParams,
}: { searchParams: Promise<{ c?: string }> }) {
  const viewer=await scopePage('wa');
  const { c } = await searchParams;
  const candidateId = viewer.role==='ADMIN' ? (c ?? 'CAN-001') : viewer.id;

  const all = await sql<{ id: string; name: string | null }[]>`
    SELECT id, name FROM app.candidate WHERE status='PROFILE_ACTIVE' AND (${viewer.role==='ADMIN'} OR id=${viewer.id}) ORDER BY id DESC LIMIT 30`;

  const [cand] = await sql<{
    id: string; name: string | null; language: 'mr' | 'hi' | 'en'; locality_key: string | null;
    max_commute_min: number; expected_pay_paise: string | null; experience_months: number;
    experience_tags: string[]; languages: string[];
    alert_quiet_from: number; alert_quiet_to: number; alert_max_per_week: number;
  }[]>`SELECT * FROM app.candidate WHERE id=${candidateId}`;

  const endorsements = await sql<{
    id: string; endorser_name: string; relationship: string; status: string;
    raw_points: number; competencies: string[]; comment: string | null;
    hidden_by_candidate: boolean;
  }[]>`SELECT * FROM app.endorsement WHERE candidate_id=${candidateId} ORDER BY created_at`;

  const resume = await resumePoint(candidateId);

  const achievements=await sql`SELECT category,description,verified FROM app.achievement WHERE candidate_id=${candidateId} ORDER BY created_at DESC`;
  return (
    <>
      <SubNav tabs={CANDIDATE_TABS} />
      <main className="page"><section className="card card-body"><h2>My achievements</h2>{achievements.map((a,i)=><p key={i}>{a.description} · {a.verified?'Verified':'Candidate provided'}</p>)}</section>
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>Profile &amp; preferences</h1>
              <div className="sub">
                Editable at any time, and the candidate controls how often we are allowed to message
                them <Clause>CAN-02 / CAN-04 / ALT-02</Clause>
              </div>
            </div>
            <CandidatePicker candidates={all} current={candidateId} base="/wa/preferences" />
          </div>
        </div>

        <div className="note mb">
          <strong>Resume point:</strong> this candidate would re-enter the journey at the{' '}
          <code>{resume.step}</code> step. An interrupted registration never starts over.
          <Clause>CAN-02</Clause>
        </div>

        {viewer.role==='CANDIDATE'&&<Extras/>}<PreferencesForm
          candidateId={candidateId}
          initial={{
            language: cand.language,
            maxCommuteMin: cand.max_commute_min,
            expectedPayRupees: Number(cand.expected_pay_paise ?? 0) / 100,
            quietFrom: cand.alert_quiet_from,
            quietTo: cand.alert_quiet_to,
            maxPerWeek: cand.alert_max_per_week,
          }}
        />

        <div className="card">
          <div className="card-head"><h2>My endorsements</h2><Clause>END-05/07/09</Clause></div>
          <div className="card-body tight">
            {endorsements.length === 0 ? <div className="empty">None yet.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Endorser</th><th>Relationship</th><th>Competencies</th><th>Comment</th><th className="num">Points</th><th>Status</th><th className="right">Visibility</th></tr></thead>
                <tbody>{endorsements.map((e) => (
                  <tr key={e.id}>
                    <td className="small">{e.endorser_name}</td>
                    <td className="small">{e.relationship.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="small">{e.competencies.join(', ').replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="small muted">{e.comment}</td>
                    <td className="num">{e.raw_points}</td>
                    <td><span className={`pill ${e.status === 'VERIFIED_CONTACT' ? 'p-ok' : e.status === 'FLAGGED' ? 'p-bad' : 'p-mute'}`}>
                      {e.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="right">
                      {['VERIFIED_CONTACT', 'HIDDEN'].includes(e.status)
                        ? <EndorsementVisibility id={e.id} hidden={e.hidden_by_candidate} />
                        : <span className="small muted">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="note small" style={{ margin: 14 }}>
              You cannot write your own endorsement, and hiding one drops it to zero points. It can
              improve your order among equally qualified people; it can never override a job
              requirement. <Clause>END-03 / END-07</Clause>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
