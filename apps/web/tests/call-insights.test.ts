import { describe, expect, it } from 'vitest';
import type { LiveCall } from '@/components/voice/types';
import { deriveOrderItems } from '@/components/voice/CallStage';

describe('deriveOrderItems', () => {
  it('does not infer live order items from clarifying text only', () => {
    const call: LiveCall = {
      call_id: 'live-1',
      source: 'twilio',
      started_at: Date.now(),
      turns: [
        { speaker: 'caller', text: "I'll do a pizza with cheese.", t_ms: 1000 },
        { speaker: 'agent', text: 'What size would you like—small, medium, or large?', t_ms: 1800 },
        { speaker: 'caller', text: 'Large.', t_ms: 2300 },
        {
          speaker: 'agent',
          text: "We don't have a large cheese pizza right now. We have medium cheese or large pepperoni.",
          t_ms: 3000,
        },
      ],
    };
    const lower = call.turns
      .map((t) => t.text)
      .join(' ')
      .toLowerCase();
    expect(deriveOrderItems(call, lower)).toEqual([]);
  });

  it('still infers order items for example transcripts without actions', () => {
    const call: LiveCall = {
      call_id: 'example-order',
      source: 'example',
      started_at: Date.now(),
      turns: [
        { speaker: 'caller', text: 'One large pepperoni please.', t_ms: 1000 },
        { speaker: 'caller', text: 'And a Caesar salad.', t_ms: 2200 },
      ],
    };
    const lower = call.turns
      .map((t) => t.text)
      .join(' ')
      .toLowerCase();
    expect(deriveOrderItems(call, lower)).toEqual(['1x Large Pepperoni Pizza', '1x Caesar Salad']);
  });
});
