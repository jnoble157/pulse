/**
 * Model pricing in USD per million tokens.
 *
 * Prices move. When they do, update this table. Every `llm.call()` reads from
 * here for cost estimation.
 */
export type ModelId =
  | 'claude-sonnet-4-5'
  | 'claude-haiku-4-5'
  | 'claude-opus-4-5'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'text-embedding-3-small'
  | 'text-embedding-3-large';

type Pricing = {
  input_per_mtok: number;
  output_per_mtok: number;
  /** Anthropic cache reads are ~10% of input cost. */
  cache_read_per_mtok?: number;
  /** Anthropic cache writes are ~125% of input cost (5-min TTL). */
  cache_write_per_mtok?: number;
};

export const PRICING: Record<ModelId, Pricing> = {
  'claude-sonnet-4-5': {
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cache_read_per_mtok: 0.3,
    cache_write_per_mtok: 3.75,
  },
  'claude-haiku-4-5': {
    input_per_mtok: 1.0,
    output_per_mtok: 5.0,
    cache_read_per_mtok: 0.1,
    cache_write_per_mtok: 1.25,
  },
  'claude-opus-4-5': {
    input_per_mtok: 15.0,
    output_per_mtok: 75.0,
    cache_read_per_mtok: 1.5,
    cache_write_per_mtok: 18.75,
  },
  'gpt-4o': { input_per_mtok: 2.5, output_per_mtok: 10 },
  'gpt-4o-mini': { input_per_mtok: 0.15, output_per_mtok: 0.6 },
  'text-embedding-3-small': { input_per_mtok: 0.02, output_per_mtok: 0 },
  'text-embedding-3-large': { input_per_mtok: 0.13, output_per_mtok: 0 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

/** Cost of a call in cents (float). Rounded to 4 decimals. */
export function costCents(model: ModelId, usage: Usage): number {
  const p = PRICING[model];
  const dollars =
    (usage.input_tokens * p.input_per_mtok) / 1_000_000 +
    (usage.output_tokens * p.output_per_mtok) / 1_000_000 +
    ((usage.cache_read_tokens ?? 0) * (p.cache_read_per_mtok ?? p.input_per_mtok)) / 1_000_000 +
    ((usage.cache_write_tokens ?? 0) * (p.cache_write_per_mtok ?? p.input_per_mtok)) / 1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}
