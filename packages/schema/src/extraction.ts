/**
 * CallExtraction — the structured output of the extraction DAG.
 *
 * Zod here is the contract for:
 *   - prompt output validation (packages/extraction)
 *   - downstream consumers (packages/guest-graph, packages/insights)
 *   - eval golden-set truth files (packages/evals)
 *
 * Every *_Signal carries a transcript_span. No span, no clickable insight.
 */
import { z } from 'zod';

export const TranscriptSpanSchema = z.object({
  turn_index: z.number().int().nonnegative(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
});
export type TranscriptSpan = z.infer<typeof TranscriptSpanSchema>;

// --- intents + outcomes ---------------------------------------------------

export const INTENT_VALUES = [
  'order_pickup',
  'order_delivery',
  'order_dinein',
  'reservation',
  'modify_order',
  'cancel_order',
  'status_check',
  'complaint',
  'faq_hours',
  'faq_location',
  'faq_menu',
  'faq_allergen',
  'catering',
  'gift_card',
  'wrong_number',
  'other',
] as const;
export const IntentSchema = z.enum(INTENT_VALUES);
export type Intent = z.infer<typeof IntentSchema>;

export const OutcomeSchema = z.enum([
  'completed',
  'abandoned',
  'transferred',
  'voicemail',
  'failed',
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

// --- cart -----------------------------------------------------------------

export const CartItemSchema = z.object({
  menu_item_id: z.string().nullable(),
  item_name_spoken: z.string(),
  quantity: z.number().int().positive(),
  modifiers: z.array(z.object({ name: z.string(), value: z.string().optional() })).default([]),
  notes: z.string().optional(),
  unit_price_cents: z.number().int().nonnegative().optional(),
  match_confidence: z.number().min(0).max(1),
  transcript_span: TranscriptSpanSchema,
});
export type CartItem = z.infer<typeof CartItemSchema>;

// --- guest signals (non-PII, post-redaction rehydrated by guest-graph) ---

export const GuestSignalsSchema = z.object({
  guest_name_token: z.string().optional(), // <GUEST_1>
  guest_phone_token: z.string().optional(), // <PHONE_1>
  is_returning_guest_hint: z.boolean().optional(),
  preferred_channel: z.enum(['sms', 'voice', 'email']).optional(),
  mentioned_special_occasion: z.string().optional(),
});

// --- per-signal shapes ----------------------------------------------------

export const QuestionSchema = z.object({
  question: z.string(),
  topic: z.enum([
    'hours',
    'location',
    'menu_item',
    'allergen',
    'dietary',
    'price',
    'wait_time',
    'delivery_area',
    'other',
  ]),
  answered: z.boolean(),
  transcript_span: TranscriptSpanSchema,
});

export const HiddenDemandSignalSchema = z.object({
  kind: z.enum([
    'dietary_restriction',
    'cuisine_preference',
    'missing_item',
    'missing_modifier',
    'missing_service',
    'other',
  ]),
  normalized_label: z.string(),
  quote: z.string(),
  confidence: z.number().min(0).max(1),
  transcript_span: TranscriptSpanSchema,
});
export type HiddenDemandSignal = z.infer<typeof HiddenDemandSignalSchema>;

export const CompetitorMentionSchema = z.object({
  name: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  context: z.enum(['fallback_option', 'price_comparison', 'service_comparison', 'other']),
  quote: z.string(),
  transcript_span: TranscriptSpanSchema,
});
export type CompetitorMention = z.infer<typeof CompetitorMentionSchema>;

export const DietaryMentionSchema = z.object({
  kind: z.enum([
    'gluten_free',
    'vegan',
    'vegetarian',
    'dairy_free',
    'nut_allergy',
    'shellfish_allergy',
    'halal',
    'kosher',
    'low_carb',
    'low_sodium',
    'other',
  ]),
  is_allergen_claim: z.boolean(),
  explicit_declaration: z.boolean(),
  quote: z.string(),
  transcript_span: TranscriptSpanSchema,
});
export type DietaryMention = z.infer<typeof DietaryMentionSchema>;

export const PriceSignalSchema = z.object({
  kind: z.enum([
    'asked_for_size_down',
    'abandoned_after_price',
    'asked_for_discount',
    'coupon_inquiry',
    'sticker_shock',
  ]),
  quote: z.string(),
  transcript_span: TranscriptSpanSchema,
});

export const ComplaintSchema = z.object({
  category: z.enum([
    'wait_time',
    'order_accuracy',
    'food_quality',
    'temperature',
    'staff',
    'delivery',
    'hygiene',
    'pricing',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  quote: z.string(),
  transcript_span: TranscriptSpanSchema,
});

export const UpsellEventSchema = z.object({
  kind: z.enum(['drink_attach', 'side_attach', 'dessert_attach', 'size_up', 'combo', 'other']),
  offered: z.boolean(),
  accepted: z.boolean(),
  anchor_item_id: z.string().nullable(),
  quote: z.string().optional(),
  transcript_span: TranscriptSpanSchema.optional(),
});

export const SentimentSchema = z.enum([
  'very_negative',
  'negative',
  'neutral',
  'positive',
  'very_positive',
]);
export const SentimentArcSchema = z.object({
  start: SentimentSchema,
  end: SentimentSchema,
  peak_low: SentimentSchema,
});

export const QualityFlagSchema = z.object({
  kind: z.enum([
    'hallucination',
    'allergen_unverified',
    'menu_item_not_in_menu',
    'tool_misuse',
    'refused_valid_request',
    'pii_leaked_to_caller',
    'missed_transfer',
    'missed_intent',
    'friction',
    'cross_tenant_reference',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  explanation: z.string(),
  transcript_span: TranscriptSpanSchema.optional(),
});

// --- the full CallExtraction ---------------------------------------------

export const CallExtractionSchema = z.object({
  call_id: z.string().uuid(),
  language: z.string().min(2),

  primary_intent: IntentSchema,
  secondary_intents: z.array(IntentSchema).default([]),
  outcome: OutcomeSchema,
  outcome_reason: z.string().optional(),

  cart: z.array(CartItemSchema).optional(),
  subtotal_cents: z.number().int().nonnegative().optional(),
  guest_signals: GuestSignalsSchema,

  questions_asked: z.array(QuestionSchema).default([]),
  hidden_demand: z.array(HiddenDemandSignalSchema).default([]),
  competitor_mentions: z.array(CompetitorMentionSchema).default([]),
  dietary_mentions: z.array(DietaryMentionSchema).default([]),
  price_sensitivity: z.array(PriceSignalSchema).default([]),
  service_complaints: z.array(ComplaintSchema).default([]),
  upsell_events: z.array(UpsellEventSchema).default([]),
  sentiment_arc: SentimentArcSchema,

  ai_quality_flags: z.array(QualityFlagSchema).default([]),

  extraction_model: z.string(),
  prompt_version: z.string(),
  cost_cents: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});
export type CallExtraction = z.infer<typeof CallExtractionSchema>;

// --- per-stage output shapes (narrower subsets) --------------------------

export const TriageOutputSchema = z.object({
  language: z.string(),
  primary_intent: IntentSchema,
  secondary_intents: z.array(IntentSchema),
  outcome: OutcomeSchema,
  outcome_reason: z.string().optional(),
  needs_deep_extraction: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const EntitiesOutputSchema = z.object({
  cart: z.array(CartItemSchema),
  subtotal_cents: z.number().int().nonnegative().optional(),
  guest_signals: GuestSignalsSchema,
  upsell_events: z.array(UpsellEventSchema),
  confidence: z.number().min(0).max(1),
});
export type EntitiesOutput = z.infer<typeof EntitiesOutputSchema>;

export const SignalsOutputSchema = z.object({
  questions_asked: z.array(QuestionSchema),
  hidden_demand: z.array(HiddenDemandSignalSchema),
  competitor_mentions: z.array(CompetitorMentionSchema),
  dietary_mentions: z.array(DietaryMentionSchema),
  price_sensitivity: z.array(PriceSignalSchema),
  service_complaints: z.array(ComplaintSchema),
  sentiment_arc: SentimentArcSchema,
});
export type SignalsOutput = z.infer<typeof SignalsOutputSchema>;

export const QaOutputSchema = z.object({
  ai_quality_flags: z.array(QualityFlagSchema),
  overall_confidence: z.number().min(0).max(1),
});
export type QaOutput = z.infer<typeof QaOutputSchema>;

// --- output shapes for individual signal prompts (Stage 3 fan-out) ------

export const HiddenDemandOutputSchema = z.object({
  hidden_demand: z.array(HiddenDemandSignalSchema),
});
export const CompetitorsOutputSchema = z.object({
  competitor_mentions: z.array(CompetitorMentionSchema),
});
export const DietaryOutputSchema = z.object({
  dietary_mentions: z.array(DietaryMentionSchema),
});
export const PriceSensitivityOutputSchema = z.object({
  price_sensitivity: z.array(PriceSignalSchema),
});
export const ComplaintsOutputSchema = z.object({
  service_complaints: z.array(ComplaintSchema),
});
export const SentimentArcOutputSchema = z.object({
  sentiment_arc: SentimentArcSchema,
  questions_asked: z.array(QuestionSchema),
});
