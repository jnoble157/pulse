/**
 * Password-gated access.
 *
 * v1 demo: single `DEMO_PASSWORD` on every page that isn't public. Clerk
 * replaces this post-v1 (SECURITY.md §4). The `/` route is now the demo
 * itself (no marketing landing) so it lives behind the gate alongside the
 * rest; only `/gate`, `/api/health`, and Next internals are public.
 *
 * The cookie is HMAC-signed (Web Crypto — works in the Next middleware
 * edge runtime) so tampering produces a 401 rather than access.
 */
import { NextRequest, NextResponse } from 'next/server';

/**
 * Public paths bypass the password gate.
 *
 * `/api/calls/live/push` is the webhook the voice agent (apps/voice/) posts
 * to from a separate process — it carries its own bearer-token auth via
 * `LIVE_CALLS_PUSH_TOKEN`, so the gate would only get in the way.
 */
const PUBLIC_PATHS = ['/_next', '/favicon.ico', '/api/health', '/api/calls/live/push'];
const GATE_COOKIE = 'pulse_gate';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const password = process.env.DEMO_PASSWORD;
  const secret = process.env.DEMO_COOKIE_SECRET;
  if (!password || !secret) {
    const accept = req.headers.get('accept') ?? '';
    const wantsHtml = accept.includes('text/html');
    if (wantsHtml) {
      return new NextResponse(
        '<!doctype html><html><body><h1>Pulse is misconfigured</h1><p>Set DEMO_PASSWORD and DEMO_COOKIE_SECRET.</p></body></html>',
        {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      );
    }
    return NextResponse.json(
      { error: 'gate_misconfigured', hint: 'Set DEMO_PASSWORD and DEMO_COOKIE_SECRET.' },
      { status: 503 },
    );
  }

  const cookie = req.cookies.get(GATE_COOKIE)?.value;
  if (cookie && (await verifyCookie(cookie, secret))) {
    return NextResponse.next();
  }

  if (pathname === '/gate' || pathname.startsWith('/gate')) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

async function verifyCookie(value: string, secret: string): Promise<boolean> {
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  const expected = await hmacHex(secret, payload);
  return timingSafeEqualHex(sig, expected);
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
