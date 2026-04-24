import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: process.env.PULSE_MODE ?? 'demo',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    at: new Date().toISOString(),
  });
}
