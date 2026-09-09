import { WithdrawForm } from './form';

export const dynamic = 'force-dynamic';

/** END-03 — the endorser withdraws through their own secure link. */
export default async function WithdrawPage({
  searchParams,
}: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1>Withdraw your endorsement</h1>
        <div className="sub">
          It stops counting immediately and stops being shown to employers.
        </div>
      </div>
      <WithdrawForm token={t ?? ''} />
    </main>
  );
}
