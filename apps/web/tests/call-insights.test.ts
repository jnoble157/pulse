import { describe, expect, it } from 'vitest';
import type { LiveCall } from '@/components/voice/types';
import { deriveCallInsights, deriveOrderItems } from '@/components/voice/CallStage';

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

  it('renders Order/Total chips from a cart snapshot when present', () => {
    const call: LiveCall = {
      call_id: 'live-snap',
      source: 'twilio',
      started_at: Date.now(),
      turns: [
        { speaker: 'agent', text: 'Hi, what can I get you?', t_ms: 0 },
        { speaker: 'caller', text: 'one medium pepperoni and one large veggie', t_ms: 1500 },
      ],
      cart: {
        items: [
          {
            menu_item_id: 'm_med_pep',
            name: 'Medium Pepperoni Pizza',
            qty: 1,
            modifiers: [],
            unit_price_cents: 1399,
          },
          {
            menu_item_id: 'm_lg_veg',
            name: 'Large Veggie Pizza',
            qty: 1,
            modifiers: [],
            unit_price_cents: 1899,
          },
        ],
        subtotal_cents: 3298,
        t_ms: 2000,
      },
    };
    const insights = deriveCallInsights(call);
    expect(insights).toContainEqual({
      label: 'Order',
      values: ['1x Medium Pepperoni Pizza', '1x Large Veggie Pizza'],
    });
    expect(insights).toContainEqual({ label: 'Total', values: ['$32.98'] });
  });

  it('infers current order sample and customer info cleanly', () => {
    const call: LiveCall = {
      call_id: 'example-order-v2',
      source: 'example',
      started_at: Date.now(),
      turns: [
        {
          speaker: 'agent',
          text: "Tony's Pizza, Austin. What can I get started for you?",
          t_ms: 0,
        },
        { speaker: 'caller', text: 'Hi, can I place a pickup order?', t_ms: 1_000 },
        { speaker: 'caller', text: 'One medium pepperoni and one large veggie.', t_ms: 2_000 },
        {
          speaker: 'agent',
          text: "Got it. That's one medium pepperoni and one large veggie. Your total is thirty-three ninety-eight. Can I get a name and phone number?",
          t_ms: 3_000,
        },
        { speaker: 'caller', text: "It's for Mike. The number is 512-555-0142.", t_ms: 4_000 },
      ],
    };
    const insights = deriveCallInsights(call);
    expect(insights).toContainEqual({
      label: 'Order',
      values: ['1x Medium Pepperoni Pizza', '1x Large Veggie Pizza'],
    });
    expect(insights).toContainEqual({ label: 'Total', values: ['$33.98'] });
    expect(insights).toContainEqual({ label: 'Customer', values: ['Mike', '(512) 555-0142'] });
  });
});
