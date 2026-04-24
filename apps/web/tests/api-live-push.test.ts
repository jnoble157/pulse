/**
 * /api/calls/live/push is the only ingress for transcript events from
 * apps/voice. The bearer-token gate is the only thing keeping a public Vercel
 * URL from being a write-anywhere SSE source. Failing this test = the demo
 * page can be poisoned by anyone with curl.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const TOKEN = 'test-token-' + Math.random().toString(36).slice(2);

beforeEach(() => {
  const env = process.env as Record<string, string | undefined>;
  vi.resetModules();
  delete env.NODE_ENV;
  delete env.VERCEL;
  delete env.PULSE_REQUIRE_PUSH_TOKEN;
  env.LIVE_CALLS_PUSH_TOKEN = TOKEN;
  (globalThis as { __pulseLiveCallStore?: unknown }).__pulseLiveCallStore = undefined;
});

afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  delete env.LIVE_CALLS_PUSH_TOKEN;
  (globalThis as { __pulseLiveCallStore?: unknown }).__pulseLiveCallStore = undefined;
});

async function importRoute() {
  return await import('../app/api/calls/live/push/route');
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/calls/live/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/calls/live/push', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const { POST } = await importRoute();
    const res = await POST(
      jsonRequest({
        kind: 'call.started',
        call_id: 'c1',
        started_at: Date.now(),
        source: 'twilio',
      }),
    );
    expect(res.status).toBe(401);
  });

  test('rejects wrong bearer with 401', async () => {
    const { POST } = await importRoute();
    const res = await POST(
      jsonRequest(
        {
          kind: 'call.started',
          call_id: 'c1',
          started_at: Date.now(),
          source: 'twilio',
        },
        { authorization: 'Bearer wrong' },
      ),
    );
    expect(res.status).toBe(401);
  });

  test('accepts valid bearer + payload with 204 and emits the event', async () => {
    const { POST } = await importRoute();
    const store = await import('../lib/live-calls');

    const seen: { kind: string }[] = [];
    store.subscribeCallEvents((event) => seen.push(event));

    const res = await POST(
      jsonRequest(
        {
          kind: 'call.started',
          call_id: 'c1',
          started_at: 1,
          source: 'twilio',
        },
        { authorization: `Bearer ${TOKEN}` },
      ),
    );
    expect(res.status).toBe(204);
    expect(seen).toEqual([expect.objectContaining({ kind: 'call.started' })]);
  });

  test('rejects malformed payload with 400', async () => {
    const { POST } = await importRoute();
    const res = await POST(
      jsonRequest(
        { kind: 'call.started' /* missing call_id, started_at, source */ },
        { authorization: `Bearer ${TOKEN}` },
      ),
    );
    expect(res.status).toBe(400);
  });

  test('fails closed in production when token is missing', async () => {
    const env = process.env as Record<string, string | undefined>;
    delete env.LIVE_CALLS_PUSH_TOKEN;
    env.NODE_ENV = 'production';
    vi.resetModules();
    const { POST } = await importRoute();
    const res = await POST(
      jsonRequest({
        kind: 'call.started',
        call_id: 'c1',
        started_at: Date.now(),
        source: 'twilio',
      }),
    );
    expect(res.status).toBe(503);
  });

  test('accepts a well-formed cart.snapshot event', async () => {
    const { POST } = await importRoute();
    const store = await import('../lib/live-calls');
    const seen: { kind: string }[] = [];
    store.subscribeCallEvents((event) => seen.push(event));

    const res = await POST(
      jsonRequest(
        {
          kind: 'cart.snapshot',
          call_id: 'c1',
          items: [
            {
              menu_item_id: 'm_med_pep',
              name: 'Medium Pepperoni Pizza',
              qty: 1,
              modifiers: [],
              unit_price_cents: 1399,
            },
          ],
          subtotal_cents: 1399,
          t_ms: 1000,
        },
        { authorization: `Bearer ${TOKEN}` },
      ),
    );
    expect(res.status).toBe(204);
    expect(seen).toEqual([expect.objectContaining({ kind: 'cart.snapshot' })]);
  });

  test('rejects an oversized cart.snapshot (too many items)', async () => {
    const { POST } = await importRoute();
    const items = Array.from({ length: 64 }, (_, i) => ({
      menu_item_id: `m_${i}`,
      name: `Item ${i}`,
      qty: 1,
      modifiers: [],
      unit_price_cents: 100,
    }));
    const res = await POST(
      jsonRequest(
        {
          kind: 'cart.snapshot',
          call_id: 'c1',
          items,
          subtotal_cents: 6400,
          t_ms: 1000,
        },
        { authorization: `Bearer ${TOKEN}` },
      ),
    );
    expect(res.status).toBe(400);
  });

  test('allows local dev when token is missing', async () => {
    const env = process.env as Record<string, string | undefined>;
    delete env.LIVE_CALLS_PUSH_TOKEN;
    env.NODE_ENV = 'development';
    vi.resetModules();
    const { POST } = await importRoute();
    const res = await POST(
      jsonRequest({
        kind: 'call.started',
        call_id: 'c1',
        started_at: Date.now(),
        source: 'twilio',
      }),
    );
    expect(res.status).toBe(204);
  });
});
