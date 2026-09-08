import { redirect } from 'next/navigation';

/**
 * QR landing route.
 *
 * The printed code is an opaque site identifier and nothing else — the
 * destination resolves here, server side, so campaigns, copy and terms can
 * change without reprinting a single sticker. In production this would 302
 * into wa.me with the code pre-filled in the message; in the prototype it
 * hands off to the simulator carrying the same attribution.
 */
export default async function QrLanding({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/wa?code=${encodeURIComponent(code)}`);
}
