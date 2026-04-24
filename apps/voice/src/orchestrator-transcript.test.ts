/**
 * Transcript-flow tests for the orchestrator.
 *
 * Locks down the four behaviors that broke in production:
 *   1. A single `is_final` triggers exactly one decide loop.
 *   2. An interim followed by `UtteranceEnd` (no final) commits the interim.
 *   3. A late `is_final` matching a recently-committed `UtteranceEnd` is deduped.
 *   4. An incomplete final ("I'll do a") followed by a better final within the
 *      hold window commits the better text and only kicks decide once.
 *   5. Two `add_to_cart` actions in one decide loop emit two `turn.appended`
 *      action events plus two `cart.snapshot` events with growing items.
 *
 * The audio modules + decide are mocked; the rest is real so we exercise the
 * actual session/cart bookkeeping.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

type DgCallbacks = { onTranscript: (t: unknown) => void; onUtteranceEnd?: () => void };
const dgState: { last: DgCallbacks | null } = { last: null };

vi.mock('./audio/deepgram.js', () => {
  return {
    DeepgramSession: class {
      constructor(opts: DgCallbacks) {
        dgState.last = { onTranscript: opts.onTranscript, onUtteranceEnd: opts.onUtteranceEnd };
      }
      send(): void {}
      close(): void {}
    },
    upsample8to16: (b: Buffer) => b,
  };
});

vi.mock('./audio/elevenlabs.js', () => ({
  streamTts: (opts: {
    onChunk: (c: Buffer) => void;
    onDone: () => void;
    onFirstChunk?: () => void;
  }) => {
    queueMicrotask(() => {
      opts.onFirstChunk?.();
      opts.onChunk(Buffer.from([0xff]));
      opts.onDone();
    });
    return { cancel: () => {} };
  },
}));

const decideMock = vi.fn();
vi.mock('./brain/decide.js', () => ({
  decide: (...args: unknown[]) => decideMock(...args),
}));

import { Orchestrator } from './orchestrator.js';
import type { TenantContext } from './orchestrator.js';
import type { VoiceEnv } from './env.js';
import type { AgentTurn } from './brain/tools.js';

type FakeWs = {
  on: (event: string, fn: (...a: unknown[]) => void) => void;
  send: (data: string) => void;
  close: () => void;
};

function fakeWs(): FakeWs {
  return {
    on: () => {},
    send: () => {},
    close: () => {},
  };
}

const TENANT: TenantContext = {
  tenantId: 't_test',
  tenantSlug: 'test',
  tenantName: 'Test Pizza',
  brandVoice: null,
  menu: [
    {
      id: 'm_med_pep',
      name: 'Medium Pepperoni Pizza',
      category: 'pizza',
      price_cents: 1399,
      allergens: [],
    },
    {
      id: 'm_lg_veg',
      name: 'Large Veggie Pizza',
      category: 'pizza',
      price_cents: 1899,
      allergens: [],
    },
    {
      id: 'm_med_che',
      name: 'Medium Cheese Pizza',
      category: 'pizza',
      price_cents: 1199,
      allergens: [],
    },
  ],
};

const ENV = {
  AGENT_MODEL: 'claude-test',
  DEEPGRAM_API_KEY: 'dg_test',
  WEB_BASE_URL: '',
  LIVE_CALLS_PUSH_TOKEN: '',
} as unknown as VoiceEnv;

function buildTranscript(text: string, isFinal: boolean) {
  return {
    is_final: isFinal,
    speech_final: isFinal,
    channel: { alternatives: [{ transcript: text, confidence: 0.9 }] },
    start: 0,
    duration: 0.4,
  };
}

function startCall(orch: Orchestrator): void {
  const startFrame = {
    event: 'start',
    sequenceNumber: '1',
    streamSid: 'MZtest',
    start: {
      accountSid: 'AC',
      callSid: 'CAtest',
      streamSid: 'MZtest',
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
    },
  };
  (orch as unknown as { handleTwilioFrame: (s: string) => void }).handleTwilioFrame(
    JSON.stringify(startFrame),
  );
}

function dg(): DgCallbacks {
  if (!dgState.last) throw new Error('DeepgramSession was never constructed');
  return dgState.last;
}

/**
 * Drain microtasks + the macrotask queue. The decide loop chains
 * `await speak(...)` which schedules its `onDone` via `queueMicrotask`, so a
 * couple of `setImmediate` round-trips flush the whole graph.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('orchestrator transcript flow', () => {
  beforeEach(() => {
    decideMock.mockReset();
    dgState.last = null;
  });

  test('a single final triggers exactly one decide loop', async () => {
    decideMock.mockResolvedValue({ action: 'say', text: 'Sure thing.' } as AgentTurn);
    const orch = new Orchestrator(fakeWs() as never, TENANT, ENV);
    startCall(orch);
    dg().onTranscript(buildTranscript('Two pizzas please.', true));
    await flush();
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  test('UtteranceEnd promotes the latest interim when no final fires', async () => {
    decideMock.mockResolvedValue({ action: 'say', text: 'Sure thing.' } as AgentTurn);
    const orch = new Orchestrator(fakeWs() as never, TENANT, ENV);
    startCall(orch);
    const cb = dg();
    cb.onTranscript(buildTranscript("I'd like to place an order", false));
    expect(decideMock).not.toHaveBeenCalled();
    cb.onUtteranceEnd?.();
    await flush();
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  test('late is_final matching a recently-committed UtteranceEnd is deduped', async () => {
    decideMock.mockResolvedValue({ action: 'say', text: 'Got it.' } as AgentTurn);
    const orch = new Orchestrator(fakeWs() as never, TENANT, ENV);
    startCall(orch);
    const cb = dg();
    cb.onTranscript(buildTranscript('two medium pepperoni pizzas', false));
    cb.onUtteranceEnd?.();
    await flush();
    expect(decideMock).toHaveBeenCalledTimes(1);
    cb.onTranscript(buildTranscript('Two medium pepperoni pizzas.', true));
    await flush();
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  test("incomplete final 'I'll do a' is held until a better final replaces it", async () => {
    vi.useFakeTimers();
    try {
      decideMock.mockResolvedValue({ action: 'say', text: 'Sure.' } as AgentTurn);
      const orch = new Orchestrator(fakeWs() as never, TENANT, ENV);
      startCall(orch);
      const cb = dg();
      cb.onTranscript(buildTranscript("I'll do a", true));
      // The decide must NOT have run — pendingFinal is holding the trail-off.
      expect(decideMock).not.toHaveBeenCalled();
      cb.onTranscript(buildTranscript("I'll do a medium pepperoni and a large veggie.", true));
      // Switch back to real timers so the speak promise can settle.
      vi.useRealTimers();
      await flush();
      expect(decideMock).toHaveBeenCalledTimes(1);
      const session = (
        orch as unknown as { session: { turns: { speaker: string; text: string }[] } }
      ).session;
      const lastCaller = [...session.turns].reverse().find((t) => t.speaker === 'caller');
      expect(lastCaller?.text).toMatch(/medium pepperoni and a large veggie/i);
    } finally {
      vi.useRealTimers();
    }
  });

  test('two add_to_cart turns in one decide loop emit two cart.snapshot events', async () => {
    decideMock
      .mockResolvedValueOnce({
        action: 'add_to_cart',
        menu_item_id: 'm_med_pep',
        quantity: 1,
      } as AgentTurn)
      .mockResolvedValueOnce({
        action: 'add_to_cart',
        menu_item_id: 'm_lg_veg',
        quantity: 1,
      } as AgentTurn)
      .mockResolvedValueOnce({
        action: 'say',
        text: 'Got it. One medium pepperoni and one large veggie.',
      } as AgentTurn);

    const orch = new Orchestrator(fakeWs() as never, TENANT, ENV);
    const emitted: Array<{ kind: string; [k: string]: unknown }> = [];
    (orch as unknown as { livePush: { emit: (e: unknown) => void } }).livePush.emit = (
      e: unknown,
    ) => {
      emitted.push(e as { kind: string });
    };
    startCall(orch);
    dg().onTranscript(buildTranscript('one medium pepperoni and one large veggie.', true));
    await flush();

    expect(decideMock).toHaveBeenCalledTimes(3);

    const cartSnapshots = emitted.filter((e) => e.kind === 'cart.snapshot');
    // One on call.started (empty) + one per cart_added = 3.
    expect(cartSnapshots.length).toBe(3);
    const lastSnapshot = cartSnapshots[cartSnapshots.length - 1] as {
      items: Array<{ name: string }>;
      subtotal_cents: number;
    };
    expect(lastSnapshot.items.map((i) => i.name)).toEqual([
      'Medium Pepperoni Pizza',
      'Large Veggie Pizza',
    ]);
    expect(lastSnapshot.subtotal_cents).toBe(1399 + 1899);

    const addEvents = emitted.filter(
      (e) =>
        e.kind === 'turn.appended' &&
        (e as { turn?: { action?: { kind: string } } }).turn?.action?.kind === 'add_to_cart',
    );
    expect(addEvents.length).toBe(2);
  });
});
