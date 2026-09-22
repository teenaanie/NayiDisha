import {redirect} from 'next/navigation';

/**
 * Printed-QR target for the standalone journey.
 *
 * Mirrors /j/[code] but lands on /apply instead of /wa, so a partner's printed
 * sticker opens the applicant-only experience. /j/[code] is left pointing at
 * /wa so the existing founder demo is unaffected.
 *
 * The code is opaque here — a partner_code or a qr_ token. start() classifies
 * it by shape and verifyAndBind() writes the attribution row at OTP time.
 */
export default async function ApplyQr({params}:{params:Promise<{code:string}>}){
 const {code}=await params;
 redirect(`/apply?code=${encodeURIComponent(code)}`);
}
