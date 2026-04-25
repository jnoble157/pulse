/**
 * PII tokenization primitives (schema types + helpers).
 *
 * Pure types + helpers for tokenized PII maps.
 *
 * Invariant: raw PII never appears in an LLM prompt
 * (AGENTS.md §Hard invariants #3).
 */
import { z } from 'zod';

export const PII_CATEGORIES = [
  'guest', // names
  'phone',
  'email',
  'address',
  'card',
  'sensitive', // SSN / DOB / license / anything review-flagged
] as const;
export type PiiCategory = (typeof PII_CATEGORIES)[number];

/** Short prefix used inside `<TOKEN_N>` tokens. */
export const PII_TOKEN_PREFIX: Record<PiiCategory, string> = {
  guest: 'GUEST',
  phone: 'PHONE',
  email: 'EMAIL',
  address: 'ADDRESS',
  card: 'CARD',
  sensitive: 'SENSITIVE',
};

/** `<GUEST_1>`, `<PHONE_2>`, etc. */
export const formatPiiToken = (category: PiiCategory, index: number): string =>
  `<${PII_TOKEN_PREFIX[category]}_${index}>`;

export const PII_TOKEN_RE = /<(GUEST|PHONE|EMAIL|ADDRESS|CARD|SENSITIVE)_\d+>/g;

export const PiiEntrySchema = z.object({
  token: z.string().regex(/^<[A-Z]+_\d+>$/),
  category: z.enum(PII_CATEGORIES),
  original: z.string(),
  first_turn_index: z.number().int().nonnegative(),
  first_offset: z.number().int().nonnegative(),
  requires_review: z.boolean().default(false),
});
export type PiiEntry = z.infer<typeof PiiEntrySchema>;

export const RedactionMapSchema = z.object({
  call_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  entries: z.array(PiiEntrySchema),
  recall_hint: z.record(z.number()).optional(), // { phone: 0.99, guest: 0.98, ... }
  created_at: z.string().datetime(),
});
export type RedactionMap = z.infer<typeof RedactionMapSchema>;
