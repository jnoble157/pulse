'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const GATE_COOKIE = 'pulse_gate';

/**
 * Gate sign-in. Uses Web Crypto (SHA-256 HMAC) — same primitive the
 * middleware uses to verify, so we avoid a Node-only `node:crypto` import
 * that would split the edge/node runtime between middleware and actions.
 */
export async function gateSubmit(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');
  const expected = process.env.DEMO_PASSWORD ?? '';
  const secret = process.env.DEMO_COOKIE_SECRET ?? '';

  if (!expected || !secret || !safeEqualString(password, expected)) {
    redirect(`/gate?next=${encodeURIComponent(next)}&error=1`);
  }

  const payload = `${Date.now()}`;
  const sig = await hmacHex(secret, payload);
  const store = await cookies();
  store.set(GATE_COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24h
    path: '/',
  });
  redirect(next);
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
