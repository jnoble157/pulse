/**
 * Smoke tests for llm.call() that don't hit the network.
 *
 * Real vendor calls are exercised by packages/evals during `pnpm evals`
 * — not here. These tests only check guardrails that must hold even when
 * env vars are missing.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { llmCall, toToolSchema } from '../src/llm.js';
import { LlmCallError } from '../src/errors.js';

describe('llmCall guardrails', () => {
  it('throws LlmCallError if ANTHROPIC_API_KEY is missing for a Claude call', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        llmCall({
          name: 'test.noop',
          version: 1,
          model: 'claude-haiku-4-5',
          cacheablePrefix: 'x',
          dynamicSuffix: 'y',
          outputSchema: z.object({ ok: z.boolean() }),
        }),
      ).rejects.toBeInstanceOf(LlmCallError);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('rejects unsupported model slugs', async () => {
    await expect(
      llmCall({
        name: 'test.noop',
        version: 1,
        // @ts-expect-error deliberately invalid
        model: 'llama-7b',
        cacheablePrefix: 'x',
        dynamicSuffix: 'y',
        outputSchema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toBeInstanceOf(LlmCallError);
  });
});

/**
 * Anthropic tool input_schema is validated against JSON Schema draft 2020-12
 * (enforced 2026-Q1). OpenAPI-only keywords like `nullable: true` cause
 * `400 tools.0.custom.input_schema: JSON schema is invalid`. These tests
 * guard against regressing to an OpenAPI-shaped emitter.
 */
describe('toToolSchema — draft-2020-12 compatibility', () => {
  const findKey = (value: unknown, key: string): boolean => {
    if (Array.isArray(value)) return value.some((v) => findKey(v, key));
    if (value && typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      if (key in rec) return true;
      return Object.values(rec).some((v) => findKey(v, key));
    }
    return false;
  };

  it('emits `type: [..., "null"]` for nullable fields, never `nullable: true`', () => {
    const schema = z.object({ menu_item_id: z.string().nullable() });
    const json = toToolSchema(schema);
    expect(findKey(json, 'nullable')).toBe(false);
    const props = (json as { properties: { menu_item_id: { type: unknown } } }).properties;
    expect(props.menu_item_id.type).toEqual(['string', 'null']);
  });

  it('strips top-level $schema to keep Anthropic strict validation happy', () => {
    const json = toToolSchema(z.object({ ok: z.boolean() }));
    expect('$schema' in json).toBe(false);
  });

  it('handles nested arrays of objects with nullable fields end-to-end', () => {
    const schema = z.object({
      cart: z.array(
        z.object({
          menu_item_id: z.string().nullable(),
          qty: z.number().int().positive(),
        }),
      ),
    });
    const json = toToolSchema(schema);
    expect(findKey(json, 'nullable')).toBe(false);
  });

});
