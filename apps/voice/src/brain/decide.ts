/**
 * Per-turn decision for the voice agent.
 *
 * Calls Claude through `llmCall` (AGENTS.md §Hard invariants #2) with the
 * `AgentTurnSchema` as the structured output. The model
 * is forced to commit to exactly one action per turn, which keeps latency
 * bounded by a single round trip.
 *
 * The transcript is short (a single call's turns), so we don't bother with
 * prompt caching here — the system prompt is the cacheable bit and llmCall
 * already attaches `cache_control: ephemeral` to the prefix.
 */
import type { z } from 'zod';
import { llmCall } from '@pulse/telemetry';
import { systemPrompt, turnsAsTranscript } from './prompt.js';
import { AgentTurnSchema, type AgentTurn, type ToolResult } from './tools.js';
import type { CallSession } from '../session.js';
import type { VoiceEnv } from '../env.js';

export async function decide(
  session: CallSession,
  env: VoiceEnv,
  observation?: ToolResult,
): Promise<AgentTurn> {
  const cacheable = systemPrompt(session);

  const obs = observation ? `\n\nLast tool returned: ${JSON.stringify(observation)}` : '';

  const cart = renderCart(session);

  const dynamic = [
    cart,
    `Call so far:`,
    turnsAsTranscript(session) || '(no turns yet)',
    obs,
    '',
    'Choose the next action.',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await llmCall<AgentTurn>({
    name: 'voice.turn',
    version: 1,
    model: env.AGENT_MODEL,
    cacheablePrefix: cacheable,
    dynamicSuffix: dynamic,
    outputSchema: AgentTurnSchema as unknown as z.ZodType<AgentTurn>,
    outputDescription:
      'Pick exactly one action for the agent to take this turn. Use `say` to speak.',
    temperature: 0.3,
    maxTokens: 400,
    metadata: {
      tenant_id: session.tenantId,
      call_id: session.callId,
      stage: 'voice.turn',
    },
  });

  return result.data;
}

/**
 * Materialize the canonical cart into the dynamic suffix so the model can
 * confirm the order and quote the subtotal verbatim. Without this the
 * agent will hallucinate prices from the menu, which is exactly what the
 * "$31.98" closeout bug was — model never saw the real cart, made up a
 * close-but-wrong number.
 */
function renderCart(session: CallSession): string {
  if (session.cart.length === 0) return '';
  const lines = session.cart.map((item) => {
    const price =
      item.unit_price_cents != null && item.unit_price_cents > 0
        ? ` ($${(item.unit_price_cents / 100).toFixed(2)})`
        : '';
    return `- ${item.quantity}x ${item.item_name_spoken}${price}`;
  });
  const subtotalCents = session.cart.reduce(
    (sum, item) => sum + (item.unit_price_cents ?? 0) * item.quantity,
    0,
  );
  const subtotal = subtotalCents > 0 ? `Subtotal: $${(subtotalCents / 100).toFixed(2)}` : null;
  return ['Current cart:', ...lines, subtotal, ''].filter(Boolean).join('\n');
}
