/**
 * Tool schemas + handlers for the voice agent's per-turn decision.
 *
 * Each turn the agent picks exactly one of these. We model it as a
 * discriminated union so the LLM is forced to commit to a single action and
 * the runtime gets a typed result. This is simpler than a full multi-tool
 * loop and keeps each turn's latency bounded by one model call.
 *
 * Tool inventory:
 *   - say              — speak the text to the caller
 *   - lookup_menu_item — search the in-memory menu for a name fuzzy-match
 *   - add_to_cart      — append an item to the running cart
 *   - quote_wait_time  — read the current wait estimate
 *   - transfer_to_staff — punt to a human (out of scope today; logged)
 *   - end_call         — politely close out
 */
import { z } from 'zod';
import type { CallSession } from '../session.js';

export const AgentTurnSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('say'),
    text: z.string().min(1).max(500).describe('Reply to read aloud to the caller. One short turn.'),
  }),
  z.object({
    action: z.literal('lookup_menu_item'),
    name: z.string().min(1).describe('The item name as the caller said it.'),
  }),
  z.object({
    action: z.literal('add_to_cart'),
    menu_item_id: z.string().describe('Stable id from a prior lookup_menu_item.'),
    quantity: z.number().int().positive().max(20),
    modifiers: z.array(z.string()).default([]),
  }),
  z.object({
    action: z.literal('quote_wait_time'),
  }),
  z.object({
    action: z.literal('transfer_to_staff'),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal('end_call'),
    reason: z.string().min(3),
  }),
]);

export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export type ToolResult =
  | { kind: 'menu_match'; items: Array<{ id: string; name: string; price_cents: number }> }
  | { kind: 'cart_added'; item: { id: string; name: string; quantity: number } }
  | { kind: 'cart_error'; reason: string }
  | { kind: 'wait_time'; minutes: number }
  | { kind: 'transferred'; reason: string }
  | { kind: 'ended'; reason: string };

/**
 * Apply a non-`say` action to the session and return a tool result the next
 * decision can read. The brain uses these results as observations on the
 * subsequent turn. `say` is handled in the audio layer (TTS), not here.
 */
export function applyTool(session: CallSession, turn: AgentTurn): ToolResult | null {
  switch (turn.action) {
    case 'say':
      return null;
    case 'lookup_menu_item': {
      const q = turn.name.toLowerCase();
      const items = session.menu
        .filter((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()))
        .slice(0, 4)
        .map((m) => ({ id: m.id, name: m.name, price_cents: m.price_cents }));
      return { kind: 'menu_match', items };
    }
    case 'add_to_cart': {
      const item = session.menu.find((m) => m.id === turn.menu_item_id);
      if (!item) return { kind: 'cart_error', reason: `unknown menu_item_id ${turn.menu_item_id}` };
      session.cart.push({
        menu_item_id: item.id,
        item_name_spoken: item.name,
        quantity: turn.quantity,
        modifiers: turn.modifiers.map((m) => ({ name: m })),
        unit_price_cents: item.price_cents,
        match_confidence: 0.9,
        transcript_span: { turn_index: session.turns.length, start_ms: 0, end_ms: 0 },
      });
      return {
        kind: 'cart_added',
        item: { id: item.id, name: item.name, quantity: turn.quantity },
      };
    }
    case 'quote_wait_time':
      return { kind: 'wait_time', minutes: 20 };
    case 'transfer_to_staff':
      session.terminal = { kind: 'transferred', reason: turn.reason };
      return { kind: 'transferred', reason: turn.reason };
    case 'end_call':
      session.terminal = { kind: 'ended', reason: turn.reason };
      return { kind: 'ended', reason: turn.reason };
  }
}
