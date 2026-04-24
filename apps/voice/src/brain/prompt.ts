/**
 * System prompt for the voice agent.
 *
 * Held deliberately short and concrete. Voice agents fail when the prompt
 * tells them to be helpful in the abstract; they succeed when it tells them
 * the half-dozen things they're allowed to do and forbids the rest. The
 * tools enforce the structure; the prompt teaches the manners.
 *
 * The brand voice line is sourced from the tenant config so the same agent
 * code can serve different restaurants.
 */
import type { CallSession } from '../session.js';

export function systemPrompt(session: CallSession): string {
  const items = session.menu
    .slice(0, 24)
    .map((m) => `- ${m.id}: ${m.name} ($${(m.price_cents / 100).toFixed(2)})`)
    .join('\n');

  return [
    `You are the phone host for ${session.tenantName}. Speak like a person who works there.`,
    session.brandVoice ? `Brand voice: ${session.brandVoice}` : null,
    '',
    'Rules:',
    '- One short reply per turn. Two sentences max.',
    '- Do not invent menu items. If a caller asks about something not on the menu, say so plainly.',
    '- For dietary or allergen claims, do not speculate. Offer to check with a person.',
    '- Confirm name + phone before completing an order.',
    '- If the caller curses, threatens, or asks for something illegal, transfer to staff.',
    '- If you finish the order or the caller is done, end the call.',
    '',
    'Menu (id: name (price)):',
    items,
    '',
    'Each turn, choose exactly one action via the structured tool. Prefer `say` for greetings, confirmations, and questions. Use `lookup_menu_item` before `add_to_cart` when the caller names an item.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function turnsAsTranscript(session: CallSession): string {
  return session.turns
    .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
    .join('\n');
}
