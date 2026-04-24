/**
 * Direct upload adapter — CSV/JSON from an operator dropping transcripts in.
 * Also the path the synthetic generator uses (ADR-012).
 */
import { z } from 'zod';
import { TranscriptPayloadSchema } from '../ingest.js';

export const UploadCallSchema = z.object({
  external_call_id: z.string().min(1),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  duration_s: z.number().int().positive(),
  audio_url: z.string().url().optional(),
  transcript: TranscriptPayloadSchema,
  metadata: z.record(z.unknown()).optional(),
});

export const UploadBatchSchema = z.object({
  tenant_id: z.string().uuid(),
  calls: z.array(UploadCallSchema),
});
export type UploadBatch = z.infer<typeof UploadBatchSchema>;
