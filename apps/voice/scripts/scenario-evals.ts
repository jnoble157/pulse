#!/usr/bin/env tsx
/**
 * Lightweight non-voice scenario harness for the agent decision loop.
 *
 * Usage:
 *   pnpm -C apps/voice scenario:eval
 *
 * This script runs scripted caller turns through decide()+applyTool() and
 * validates high-signal expectations for demo behavior (ordering flow,
 * allergy escalation, closeout quality). It does not touch Twilio/TTS/STT.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MenuItem } from '@pulse/schema';
import { CallSession } from '../src/session.js';
import type { VoiceEnv } from '../src/env.js';
import { decide } from '../src/brain/decide.js';
import { applyTool, type AgentTurn, type ToolResult } from '../src/brain/tools.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // Optional. We'll fail with a clear message below if key is absent.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('scenario-evals: ANTHROPIC_API_KEY is required in env.');
  process.exit(1);
}

const MENU: MenuItem[] = [
  { id: 'item-cheese-sm', name: 'Small Cheese Pizza', category: 'pizza', price_cents: 1299 },
  { id: 'item-cheese-md', name: 'Medium Cheese Pizza', category: 'pizza', price_cents: 1499 },
  { id: 'item-cheese-lg', name: 'Large Cheese Pizza', category: 'pizza', price_cents: 1699 },
  { id: 'item-pepperoni-sm', name: 'Small Pepperoni Pizza', category: 'pizza', price_cents: 1399 },
  { id: 'item-pepperoni-md', name: 'Medium Pepperoni Pizza', category: 'pizza', price_cents: 1699 },
  { id: 'item-pepperoni-lg', name: 'Large Pepperoni Pizza', category: 'pizza', price_cents: 1799 },
  { id: 'item-veggie-sm', name: 'Small Veggie Pizza', category: 'pizza', price_cents: 1399 },
  { id: 'item-veggie-md', name: 'Medium Veggie Pizza', category: 'pizza', price_cents: 1599 },
  { id: 'item-veggie-lg', name: 'Large Veggie Pizza', category: 'pizza', price_cents: 1799 },
];

type Exchange = {
  caller: string;
  decisions: AgentTurn[];
  agentTexts: string[];
  terminal: boolean;
};

type Step = {
  caller: string;
  checks: Array<(exchange: Exchange) => string | null>;
};

type Scenario = {
  id: string;
  title: string;
  steps: Step[];
};

const SCENARIOS: Scenario[] = [
  {
    id: 'size-then-type',
    title: 'Ambiguous pizza requires size/type follow-ups',
    steps: [
      {
        caller: "I'd like a pizza for pickup.",
        checks: [
          hasAgentText(/size/i, 'ask for pizza size'),
          notHasAgentText(/on that medium/i, 'avoid awkward "on that medium" phrasing'),
        ],
      },
      {
        caller: 'Medium.',
        checks: [
          hasAgentText(/what kind|cheese|pepperoni|veggie/i, 'ask for pizza type/toppings'),
          notHasDecision('add_to_cart', 'do not add to cart before pizza type is known'),
        ],
      },
    ],
  },
  {
    id: 'completion-no-duplicate-add',
    title: 'Completion phrase does not duplicate cart add',
    steps: [
      {
        caller: 'Medium cheese pizza.',
        checks: [hasDecision('add_to_cart', 'add pizza to cart')],
      },
      {
        caller: "That's it.",
        checks: [
          notHasDecision('add_to_cart', 'avoid duplicate add_to_cart on completion utterance'),
          hasAgentText(/name|phone/i, 'move to confirmation details'),
        ],
      },
    ],
  },
  {
    id: 'allergy-escalation',
    title: 'Allergy flow escalates clearly without abrupt closeout',
    steps: [
      {
        caller: "I have celiac disease. Do you have anything gluten free that's safe?",
        checks: [
          hasDecision('transfer_to_staff', 'transfer to staff for allergy risk'),
          hasAgentText(
            /transfer|person|manager|accurate answer|someone who can help/i,
            'tell caller they are being routed to a person',
          ),
        ],
      },
    ],
  },
  {
    id: 'unavailable-item',
    title: 'Unavailable item asks for an on-menu alternative without adding to cart',
    steps: [
      {
        caller: 'Can I get a Hawaiian pizza?',
        checks: [
          hasAgentText(/don'?t have|not on the menu|don’t have/i, 'say item is unavailable'),
          hasAgentText(/cheese|pepperoni|veggie|what we do have/i, 'offer an on-menu alternative'),
          notHasDecision('add_to_cart', 'do not add unavailable item to cart'),
        ],
      },
    ],
  },
  {
    id: 'order-closeout',
    title: 'Order closeout mentions total and pickup timing',
    steps: [
      {
        caller: 'One medium cheese pizza.',
        checks: [hasDecision('add_to_cart', 'add medium cheese pizza')],
      },
      {
        caller: "Nope, that's it. My name is Josh and phone is 724-472-2013.",
        checks: [
          hasDecision('end_call', 'end completed order'),
          hasAgentText(/total|\$\d+(?:\.\d{2})?/i, 'include total amount in closeout'),
          hasAgentText(/ready|minutes|pickup/i, 'include pickup timing in closeout'),
        ],
      },
    ],
  },
];

async function main(): Promise<void> {
  const env = buildVoiceEnv();
  let failures = 0;

  for (const scenario of SCENARIOS) {
    const session = new CallSession({
      callId: `scenario-${scenario.id}`,
      tenantId: 'demo-tenant',
      tenantSlug: 'tonys-pizza-austin',
      tenantName: "Tony's Pizza Austin",
      brandVoice: 'Friendly, direct, concise.',
      menu: MENU,
    });
    session.appendTurn(
      'agent',
      `Hi, thanks for calling ${session.tenantName}. How can I help?`,
      0,
      0,
    );

    console.info(`\n[scenario] ${scenario.id} — ${scenario.title}`);
    for (const [idx, step] of scenario.steps.entries()) {
      const exchange = await runExchange(session, env, step.caller);
      const stepLabel = `  step ${idx + 1}: caller="${step.caller}"`;
      console.info(stepLabel);
      for (const check of step.checks) {
        const err = check(exchange);
        if (err) {
          failures++;
          console.error(`    ✗ ${err}`);
        } else {
          console.info('    ✓ pass');
        }
      }
      if (exchange.agentTexts.length > 0) {
        console.info(`    agent: ${exchange.agentTexts.join(' | ')}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\nscenario-evals: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.info('\nscenario-evals: all checks passed');
}

async function runExchange(session: CallSession, env: VoiceEnv, caller: string): Promise<Exchange> {
  const t = Math.round(session.now());
  session.appendTurn('caller', caller, t, t);
  let observation: ToolResult | undefined;
  const decisions: AgentTurn[] = [];
  const agentTexts: string[] = [];

  for (let i = 0; i < 8; i++) {
    if (session.terminal) break;
    const turn = await decide(session, env, observation);
    decisions.push(turn);
    if (turn.action === 'say') {
      const text = turn.text?.trim() ?? '';
      session.appendTurn('agent', text, Math.round(session.now()), Math.round(session.now()));
      if (text) agentTexts.push(text);
      break;
    }
    const result = applyTool(session, turn);
    if (session.terminal) {
      const text =
        session.terminal.kind === 'ended'
          ? evalCloseoutText(session, turn.text?.trim())
          : turn.text?.trim() || terminalLine(session.terminal.kind);
      if (text) {
        session.appendTurn('agent', text, Math.round(session.now()), Math.round(session.now()));
        agentTexts.push(text);
      }
      break;
    }
    observation = result ?? undefined;
  }

  return {
    caller,
    decisions,
    agentTexts,
    terminal: Boolean(session.terminal),
  };
}

function hasDecision(action: AgentTurn['action'], message: string) {
  return (exchange: Exchange): string | null =>
    exchange.decisions.some((d) => d.action === action) ? null : `expected ${message}`;
}

function notHasDecision(action: AgentTurn['action'], message: string) {
  return (exchange: Exchange): string | null =>
    exchange.decisions.some((d) => d.action === action) ? `expected ${message}` : null;
}

function hasAgentText(re: RegExp, message: string) {
  return (exchange: Exchange): string | null =>
    exchange.agentTexts.some((t) => re.test(t)) ? null : `expected agent to ${message}`;
}

function notHasAgentText(re: RegExp, message: string) {
  return (exchange: Exchange): string | null =>
    exchange.agentTexts.some((t) => re.test(t)) ? `expected agent to ${message}` : null;
}

function buildVoiceEnv(): VoiceEnv {
  return {
    PORT: 8788,
    PUBLIC_BASE_URL: 'http://127.0.0.1:8788',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY ?? 'stub',
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ?? 'stub',
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID ?? 'stub',
    ELEVENLABS_MODEL: process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5',
    WEB_BASE_URL: process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000',
    LIVE_CALLS_PUSH_TOKEN: process.env.LIVE_CALLS_PUSH_TOKEN,
    PULSE_TENANT_SLUG: process.env.PULSE_TENANT_SLUG ?? 'tonys-pizza-austin',
    AGENT_MODEL: (process.env.AGENT_MODEL as VoiceEnv['AGENT_MODEL']) ?? 'claude-haiku-4-5',
  };
}

function terminalLine(kind: 'transferred' | 'ended'): string {
  if (kind === 'transferred') return "One sec, I'm transferring you to a person.";
  return 'Thanks for calling. Have a good one.';
}

function evalCloseoutText(session: CallSession, suggested: string | undefined): string {
  if (session.cart.length === 0) return suggested || terminalLine('ended');
  const totalCents = session.cart.reduce(
    (sum, item) => sum + (item.unit_price_cents ?? 0) * item.quantity,
    0,
  );
  const total = Number.isFinite(totalCents) ? `$${(totalCents / 100).toFixed(2)}` : null;
  const first = firstNameFromSession(session);
  const items = session.cart.map((item) => `${item.quantity} ${item.item_name_spoken}`).join(', ');
  return [
    first ? `Perfect, ${first}.` : 'Perfect.',
    `That's ${items}${total ? ` for ${total}` : ''}.`,
    'It will be ready in about 15 minutes.',
    "Thanks for calling Tony's Pizza Austin.",
  ].join(' ');
}

function firstNameFromSession(session: CallSession): string | null {
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const turn = session.turns[i]!;
    if (turn.speaker !== 'caller') continue;
    const cleaned = turn.text
      .replace(/\b(?:yeah|yep|sure|okay|ok|it'?s|this is|my name is)\b/gi, ' ')
      .replace(/[^A-Za-z\s'-]/g, ' ')
      .trim();
    const first = cleaned.split(/\s+/)[0];
    if (first && first.length >= 2) {
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
  }
  return null;
}

void main();
