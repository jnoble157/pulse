import { describe, expect, test, vi } from 'vitest';

const unsubscribe = vi.fn();

vi.mock('../lib/live-calls', () => {
  return {
    snapshotCalls: () => [],
    subscribeCallEvents: () => unsubscribe,
  };
});

describe('GET /api/calls/live', () => {
  test('cancelling the stream unsubscribes listeners', async () => {
    unsubscribe.mockReset();
    const { GET } = await import('../app/api/calls/live/route');
    const res = await GET();
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    await reader?.read();
    await reader?.cancel('test done');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
