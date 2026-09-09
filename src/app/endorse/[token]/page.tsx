import { endorsementByToken } from '@/modules/lifecycle';
import { EndorserForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * END-02 — the endorser's page. No login, no account, no app. They arrive from
 * a single-use expiring link, verify a channel, and write their own words.
 * The candidate can never author this.
 */
export default async function EndorsePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const e = await endorsementByToken(token);

  if (!e) {
    return (
      <main className="page" style={{ maxWidth: 620 }}>
        <h1>Link not found</h1>
        <p className="muted">This invitation has already been used, or it never existed.</p>
      </main>
    );
  }
  if (e.status !== 'PENDING') {
    return (
      <main className="page" style={{ maxWidth: 620 }}>
        <h1>Already submitted</h1>
        <p className="muted">Thank you — this endorsement has been recorded.</p>
      </main>
    );
  }

  const name = (e.candidate_name ?? 'this person').replace(/^DEMO\s+/i, '');
  return (
    <main className="page" style={{ maxWidth: 620 }}>
      <div className="page-head">
        <h1>A few words about {name}</h1>
        <div className="sub">
          {name} has asked you to say how you know them and what they are good at. It takes about a
          minute, and you do not need an account.
        </div>
      </div>
      <EndorserForm token={token} candidateName={name} />
    </main>
  );
}
