import { describe, it, expect } from 'vitest';
import { CallExtractionSchema } from '../src/extraction.js';

describe('CallExtractionSchema', () => {
  it('round-trips a minimal valid extraction', () => {
    const ex = {
      call_id: 'c4ca4238-a0b9-4823-8c6e-1e39f8c0d8b4',
      language: 'en',
      primary_intent: 'order_pickup' as const,
      secondary_intents: [],
      outcome: 'completed' as const,
      guest_signals: {},
      questions_asked: [],
      hidden_demand: [],
      competitor_mentions: [],
      dietary_mentions: [],
      price_sensitivity: [],
      service_complaints: [],
      upsell_events: [],
      sentiment_arc: {
        start: 'neutral' as const,
        end: 'positive' as const,
        peak_low: 'neutral' as const,
      },
      ai_quality_flags: [],
      extraction_model: 'claude-sonnet-4-5',
      prompt_version: 'entities.cart@v1',
      cost_cents: 0.8,
      confidence: 0.91,
    };
    expect(() => CallExtractionSchema.parse(ex)).not.toThrow();
  });
});
