/**
 * Tool schemas + handlers for the voice agent's per-turn decision.
 *
 * Each turn the agent picks exactly one action. We use a single object schema
 * + `superRefine` (not `z.discriminatedUnion`) so the JSON Schema for
 * Anthropic tools stays a plain `type:object` — Anthropic rejects top-level
 * `anyOf` / `oneOf` on `input_schema`.
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

const agentAction = z.enum([
  'say',
  'lookup_menu_item',
  'add_to_cart',
  'quote_wait_time',
  'transfer_to_staff',
  'end_call',
]);

export const AgentTurnSchema = z
  .object({
    action: agentAction.describe('Exactly one action for this turn.'),
    text: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Required when action is say. Optional for end_call: final closeout spoken before disconnecting.',
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('Required when action is lookup_menu_item: item name as the caller said it.'),
    menu_item_id: z
      .string()
      .optional()
      .describe('Required when action is add_to_cart: id from a prior lookup_menu_item.'),
    quantity: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .describe('Required when action is add_to_cart.'),
    modifiers: z.array(z.string()).optional().describe('Optional extras for add_to_cart.'),
    reason: z
      .string()
      .min(3)
      .optional()
      .describe('Required when action is transfer_to_staff or end_call.'),
  })
  .superRefine((val, ctx) => {
    const need = (path: keyof typeof val, msg: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message: msg });
    };
    switch (val.action) {
      case 'say':
        if (!val.text) need('text', 'say requires text');
        break;
      case 'lookup_menu_item':
        if (!val.name) need('name', 'lookup_menu_item requires name');
        break;
      case 'add_to_cart':
        if (!val.menu_item_id) need('menu_item_id', 'add_to_cart requires menu_item_id');
        if (val.quantity === undefined) need('quantity', 'add_to_cart requires quantity');
        break;
      case 'quote_wait_time':
        break;
      case 'transfer_to_staff':
      case 'end_call':
        if (!val.reason) need('reason', `${val.action} requires reason`);
        break;
      default:
        break;
    }
  });

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
      const q = (turn.name ?? '').toLowerCase();
      const items = session.menu
        .filter((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()))
        .slice(0, 4)
        .map((m) => ({ id: m.id, name: m.name, price_cents: m.price_cents }));
      return { kind: 'menu_match', items };
    }
    case 'add_to_cart': {
      const menuItemId = turn.menu_item_id!;
      const qty = turn.quantity!;
      const item = session.menu.find((m) => m.id === menuItemId);
      if (!item) return { kind: 'cart_error', reason: `unknown menu_item_id ${menuItemId}` };
      session.cart.push({
        menu_item_id: item.id,
        item_name_spoken: item.name,
        quantity: qty,
        modifiers: (turn.modifiers ?? []).map((m) => ({ name: m })),
        unit_price_cents: item.price_cents,
        match_confidence: 0.9,
        transcript_span: { turn_index: session.turns.length, start_ms: 0, end_ms: 0 },
      });
      return {
        kind: 'cart_added',
        item: { id: item.id, name: item.name, quantity: qty },
      };
    }
    case 'quote_wait_time':
      return { kind: 'wait_time', minutes: 20 };
    case 'transfer_to_staff': {
      const r = turn.reason!;
      session.terminal = { kind: 'transferred', reason: r };
      return { kind: 'transferred', reason: r };
    }
    case 'end_call': {
      const r = turn.reason!;
      session.terminal = { kind: 'ended', reason: r };
      return { kind: 'ended', reason: r };
    }
  }
}
