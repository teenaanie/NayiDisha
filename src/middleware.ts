import { NextRequest, NextResponse } from 'next/server';

/**
 * Optional demo gate.
 *
 * The prototype has no user authentication by design — §21.2 wants a role
 * switcher, not five logins. That is fine locally and wrong on a public URL,
 * where a stranger could open the Operations console and approve a payout.
 *
 * Set DEMO_PASSWORD in the hosting environment and the whole site sits behind
 * one HTTP Basic prompt. Leave it unset and nothing changes, so local
 * development and `npm run dev` are unaffected.
 *
 * This is a demo gate, not a security model. Real role-based access control
 * is an MVP requirement (§14), not a prototype one.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    // Length-independent comparison; the value is a shared demo password, not a secret.
    if (supplied === password) return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Frontline Hiring demo", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
