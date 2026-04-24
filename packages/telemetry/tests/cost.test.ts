import { describe, it, expect } from 'vitest';
import { costCents, PRICING } from '../src/cost.js';

describe('costCents', () => {
  it('computes Haiku cost for a small triage call', () => {
    // 1500 input * $1/Mtok = $0.0015; 200 output * $5/Mtok = $0.001; total $0.0025 = 0.25¢.
    const c = costCents('claude-haiku-4-5', { input_tokens: 1500, output_tokens: 200 });
    expect(c).toBeCloseTo(0.25, 4);
  });

  it('accounts for cache reads cheaper than input', () => {
    const full = costCents('claude-sonnet-4-5', { input_tokens: 10_000, output_tokens: 500 });
    const cached = costCents('claude-sonnet-4-5', {
      input_tokens: 200,
      output_tokens: 500,
      cache_read_tokens: 9_800,
    });
    expect(cached).toBeLessThan(full);
  });

  it('every ModelId in PRICING has input and output rates', () => {
    for (const [id, p] of Object.entries(PRICING)) {
      expect(p.input_per_mtok, id).toBeGreaterThanOrEqual(0);
      expect(p.output_per_mtok, id).toBeGreaterThanOrEqual(0);
    }
  });
});
