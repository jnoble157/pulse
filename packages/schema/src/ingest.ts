/**
 * Canonical shape of a call event as Pulse knows it, post-adapter.
 *
 * Per ADR-012, Pulse is provider-agnostic. Every vendor adapter in
 * apps/api/ingest/providers/<provider>.ts translates to IngestCallEvent.
 */
import { z } from 'zod';
import { PROVIDER } from './db.js';

export const TranscriptTurnSchema = z.object({
  speaker: z.enum(['agent', 'caller']),
  text: z.string(),
  t_start_ms: z.number().int().nonnegative(),
  t_end_ms: z.number().int().nonnegative(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const TranscriptPayloadSchema = z.object({
  turns: z.array(TranscriptTurnSchema),
  language: z.string().min(2).max(8).optional(),
  diarization_confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;

export const IngestCallEventSchema = z.object({
  tenant_id: z.string().uuid(),
  external_call_id: z.string().min(1).max(256),
  provider: z.enum(PROVIDER),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  duration_s: z.number().int().positive(),
  audio_url: z.string().url().optional(),
  transcript: TranscriptPayloadSchema,
  metadata: z.record(z.unknown()).optional(),
});
export type IngestCallEvent = z.infer<typeof IngestCallEventSchema>;

export const idempotencyKey = (
  provider: string,
  tenant_id: string,
  external_call_id: string,
): string => `${provider}:${tenant_id}:${external_call_id}`;
