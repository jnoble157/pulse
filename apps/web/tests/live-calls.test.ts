/**
 * In-process pub/sub for live calls. The voice agent posts events; SSE
 * subscribers and the homepage depend on these invariants:
 *
 *   1. publish() fans out to every active listener
 *   2. snapshot() reflects the current state for late subscribers
 *   3. event ordering is preserved (call.started → turn.appended × N → call.ended)
 *
 * The store is module-level + globalThis-stashed (for Next dev HMR), so the
 * tests reset it between specs by clearing the global handle.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type StoreModule = typeof import('../lib/live-calls');

async function freshStore(): Promise<StoreModule> {
  // The store is a module-level singleton (stashed on globalThis to survive
  // Next HMR). Reset both the module cache and the global handle so each test
  // gets a brand-new store.
  (globalThis as { __pulseLiveCallStore?: unknown }).__pulseLiveCallStore = undefined;
  vi.resetModules();
  return await import('../lib/live-calls');
}

describe('LiveCallStore', () => {
  let store: StoreModule;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(() => {
    (globalThis as { __pulseLiveCallStore?: unknown }).__pulseLiveCallStore = undefined;
  });

  test('emit fans out to every active listener', () => {
    const a: StoreModule['CallEvent' & 'irrelevant'][] = [];
    const b: StoreModule['CallEvent' & 'irrelevant'][] = [];
    const unsubA = store.subscribeCallEvents((e) => a.push(e as never));
    const unsubB = store.subscribeCallEvents((e) => b.push(e as never));

    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 1,
      source: 'twilio',
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'call.started', call_id: 'c1' });

    unsubA();
    store.emitCallEvent({
      kind: 'call.ended',
      call_id: 'c1',
      ended_at: 2,
      reason: 'completed',
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);

    unsubB();
  });

  test('snapshot returns active calls so late subscribers can catch up', () => {
    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 100,
      source: 'twilio',
      caller_label: '+15551234567',
    });
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'agent', text: "Tony's Pizza, Austin.", t_ms: 0 },
    });
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'caller', text: 'One large pepperoni.', t_ms: 1500 },
    });

    const snap = store.snapshotCalls();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      call_id: 'c1',
      source: 'twilio',
      caller_label: '+15551234567',
      started_at: 100,
    });
    expect(snap[0].turns).toHaveLength(2);
    expect(snap[0].turns[1].text).toBe('One large pepperoni.');
  });

  test('preserves call.started → turn.appended × N → call.ended ordering', () => {
    const seen: string[] = [];
    store.subscribeCallEvents((event) => {
      if (event.kind === 'turn.appended') {
        seen.push(`turn:${event.turn.speaker}`);
      } else {
        seen.push(event.kind);
      }
    });

    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 0,
      source: 'twilio',
    });
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'agent', text: 'a', t_ms: 0 },
    });
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'caller', text: 'b', t_ms: 1 },
    });
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'agent', text: 'c', t_ms: 2 },
    });
    store.emitCallEvent({
      kind: 'call.ended',
      call_id: 'c1',
      ended_at: 3,
      reason: 'completed',
    });

    expect(seen).toEqual(['call.started', 'turn:agent', 'turn:caller', 'turn:agent', 'call.ended']);
  });

  test('listener errors do not crash the producer or block other listeners', () => {
    const seen: string[] = [];
    store.subscribeCallEvents(() => {
      throw new Error('boom');
    });
    store.subscribeCallEvents((event) => seen.push(event.kind));

    expect(() =>
      store.emitCallEvent({
        kind: 'call.started',
        call_id: 'c1',
        started_at: 0,
        source: 'example',
      }),
    ).not.toThrow();
    expect(seen).toEqual(['call.started']);
  });

  test('turn.appended before call.started is buffered, then merged when start arrives', () => {
    store.emitCallEvent({
      kind: 'turn.appended',
      call_id: 'c1',
      turn: { speaker: 'agent', text: 'early', t_ms: 0 },
    });
    const mid = store.snapshotCalls();
    expect(mid).toHaveLength(1);
    expect(mid[0].turns).toHaveLength(1);
    expect(mid[0].turns[0].text).toBe('early');

    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 100,
      source: 'twilio',
      caller_label: '+15551234567',
    });
    const fin = store.snapshotCalls()[0];
    expect(fin.turns).toHaveLength(1);
    expect(fin.started_at).toBe(100);
    expect(fin.caller_label).toBe('+15551234567');
  });

  test('cart.snapshot is stored on the call and newer wins by t_ms', () => {
    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 0,
      source: 'twilio',
    });
    store.emitCallEvent({
      kind: 'cart.snapshot',
      call_id: 'c1',
      items: [
        {
          menu_item_id: 'a',
          name: 'A',
          qty: 1,
          modifiers: [],
          unit_price_cents: 100,
        },
      ],
      subtotal_cents: 100,
      t_ms: 200,
    });
    let snap = store.snapshotCalls()[0];
    expect(snap.cart?.items.map((i) => i.name)).toEqual(['A']);
    expect(snap.cart?.subtotal_cents).toBe(100);

    // Older snapshot should be ignored (out-of-order delivery).
    store.emitCallEvent({
      kind: 'cart.snapshot',
      call_id: 'c1',
      items: [],
      subtotal_cents: 0,
      t_ms: 100,
    });
    snap = store.snapshotCalls()[0];
    expect(snap.cart?.items).toHaveLength(1);

    // Newer snapshot wins.
    store.emitCallEvent({
      kind: 'cart.snapshot',
      call_id: 'c1',
      items: [
        { menu_item_id: 'a', name: 'A', qty: 1, modifiers: [], unit_price_cents: 100 },
        { menu_item_id: 'b', name: 'B', qty: 1, modifiers: [], unit_price_cents: 200 },
      ],
      subtotal_cents: 300,
      t_ms: 300,
    });
    snap = store.snapshotCalls()[0];
    expect(snap.cart?.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(snap.cart?.subtotal_cents).toBe(300);
  });

  test('cart.snapshot before call.started is preserved when call.started arrives', () => {
    // Producer queues `call.started` then `cart.snapshot`, but the two HTTP
    // POSTs from the voice agent can land out of order at the push route.
    store.emitCallEvent({
      kind: 'cart.snapshot',
      call_id: 'c1',
      items: [{ menu_item_id: 'a', name: 'A', qty: 1, modifiers: [], unit_price_cents: 100 }],
      subtotal_cents: 100,
      t_ms: 50,
    });
    // Stub created so the cart isn't dropped.
    expect(store.snapshotCalls()[0].cart?.subtotal_cents).toBe(100);

    store.emitCallEvent({
      kind: 'call.started',
      call_id: 'c1',
      started_at: 1234,
      source: 'twilio',
      caller_label: 'Inbound · +15555550100',
    });
    const snap = store.snapshotCalls()[0];
    expect(snap.cart?.items.map((i) => i.name)).toEqual(['A']);
    expect(snap.started_at).toBe(1234);
    expect(snap.caller_label).toBe('Inbound · +15555550100');
  });

  test('call.ended for a call that never existed is still ignored', () => {
    store.emitCallEvent({
      kind: 'call.ended',
      call_id: 'ghost',
      ended_at: 1,
      reason: 'error',
    });
    expect(store.snapshotCalls()).toHaveLength(0);
  });
});
