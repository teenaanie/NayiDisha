import { Suspense } from 'react';
import { sql } from '@/lib/db';
import { identity } from '@/lib/auth';
import { PhoneFrame } from '../phone-frame';
import { ScreeningClient } from './screening-client';
import { hasScreeningConsent } from '../screening-actions';

export const dynamic = 'force-dynamic';

/**
 * QR screening landing.
 *
 * A printed code resolves to /j/<token>, which carries the site through to
 * here. The candidate consents and is screened straight away — the shortest
 * path from a sticker on a wall to a matched profile.
 */
async function Content({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const actor = await identity();
  if (actor?.role !== 'CANDIDATE') {
    return (
      <div className="wa-msg wa-in wa-reply-panel">
        <strong>Start your journey first</strong>
        <p className="small">Register and verify your number, then the screening can build the rest of your profile.</p>
        <a className="btn btn-primary" href={code ? `/wa?code=${encodeURIComponent(code)}` : '/wa'}>Start</a>
      </div>
    );
  }

  const [[cand], site, consented] = await Promise.all([
    sql<{ language: 'en'|'hi'|'mr' }[]>`SELECT language FROM app.candidate WHERE id=${actor.id}`,
    code ? sql<{ id: string }[]>`SELECT id FROM app.partner_site WHERE qr_token=${code} OR partner_code=${code}` : Promise.resolve([]),
    hasScreeningConsent(),
  ]);

  return <ScreeningClient initialLang={cand?.language ?? 'en'} consented={consented} siteId={site[0]?.id ?? null} />;
}

export default function ScreeningPage(props: { searchParams: Promise<{ code?: string }> }) {
  return (
    <main className="page">
      <div className="nd-journey-intro">
        <div className="nd-section-kicker">Scanned a code?</div>
        <h1>Two minutes to your profile.</h1>
        <p>Answer a few questions out loud. No forms, no typing.</p>
      </div>
      <PhoneFrame>
        <Suspense fallback={<div className="wa-msg wa-in" role="status">Preparing your screening…</div>}>
          <Content {...props} />
        </Suspense>
      </PhoneFrame>
    </main>
  );
}
