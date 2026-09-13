import {sql} from '@/lib/db';
import {Icon} from './icons';

/** One stat card. `tint` picks a token pair from globals.css. */
function Stat({icon, tint, value, label, detail}: {
  icon: string; tint: string; value: string; label: string; detail: string;
}) {
  return (
    <div className="statcard" style={{
      ['--tint-bg' as string]: `var(--tint-${tint}-bg)`,
      ['--tint-ic' as string]: `var(--tint-${tint}-ic)`,
    }}>
      <span className="ic"><Icon name={icon} size={19} /></span>
      <div>
        <div className="v">{value}</div>
        <div className="k">{label}</div>
        <div className="d">{detail}</div>
      </div>
    </div>
  );
}

/**
 * The ten placement figures, as two rows of stat cards.
 *
 * Deliberately no trend arrows: nothing snapshots these counts over time, so a
 * "+20% this month" badge would be invented rather than measured.
 */
export async function PlacementSummary() {
  const [c] = await sql<{
    candidates: string; assessed: string; awaiting_assessment: string; closed_jobs: string;
    suggestions: string; awaiting_interest: string; confirmed_applications: string;
    unlocks: string; referrals: string; referral_paise: string;
  }[]>`SELECT
    (SELECT count(*) FROM app.candidate) candidates,
    (SELECT count(DISTINCT candidate_id) FROM app.assessment_attempt) assessed,
    (SELECT count(*) FROM app.candidate c WHERE NOT EXISTS(SELECT 1 FROM app.assessment_attempt a WHERE a.candidate_id=c.id)) awaiting_assessment,
    (SELECT count(*) FROM app.job WHERE status IN ('CLOSED','FILLED','EXPIRED')) closed_jobs,
    (SELECT count(*) FROM app.job_suggestion WHERE eligible AND NOT hidden) suggestions,
    (SELECT count(*) FROM app.application WHERE reconfirmed_at IS NULL AND status NOT IN ('WITHDRAWN','REJECTED','JOINED')) awaiting_interest,
    (SELECT count(*) FROM app.application WHERE reconfirmed_at IS NOT NULL) confirmed_applications,
    (SELECT count(*) FROM app.qualified_lead_unlock WHERE status='CONFIRMED') unlocks,
    (SELECT count(*) FROM app.attribution WHERE partner_id IS NOT NULL) referrals,
    (SELECT COALESCE(sum(amount_paise),0) FROM app.reward_ledger WHERE status<>'REVERSED') referral_paise`;

  return (
    <>
      <div className="statgrid s4">
        <Stat icon="candidates" tint="blue" value={c.candidates} label="Candidates" detail="Total registered" />
        <Stat icon="shield" tint="green" value={c.assessed} label="Assessed" detail="Completed an assessment" />
        <Stat icon="applications" tint="amber" value={c.confirmed_applications} label="Applications" detail="Interest confirmed" />
        <Stat icon="jobs" tint="purple" value={c.closed_jobs} label="Closed jobs" detail="Filled, closed or expired" />
      </div>
      <div className="statgrid s6">
        <Stat icon="spark" tint="pink" value={c.suggestions} label="Suggestions" detail="Eligible, not hidden" />
        <Stat icon="hourglass" tint="cyan" value={c.awaiting_assessment} label="Awaiting assessment" detail="No attempt yet" />
        <Stat icon="heart" tint="pink" value={c.awaiting_interest} label="Awaiting interest" detail="Not reconfirmed" />
        <Stat icon="referrals" tint="blue" value={c.referrals} label="Referrals" detail="Partner-attributed" />
        <Stat icon="lock" tint="green" value={c.unlocks} label="Unlocks" detail="Confirmed unlocks" />
        <Stat icon="rupee" tint="purple" value={'₹' + Number(c.referral_paise) / 100} label="Referral payout" detail="Ledger total" />
      </div>
    </>
  );
}
