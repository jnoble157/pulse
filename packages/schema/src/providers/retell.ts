import { z } from 'zod';

export const RetellTranscriptTurnSchema = z.object({
  role: z.enum(['agent', 'user']),
  content: z.string(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .optional(),
});

export const RetellWebhookSchema = z.object({
  event: z.literal('call_ended'),
  call: z.object({
    call_id: z.string(),
    agent_id: z.string(),
    start_timestamp: z.number(),
    end_timestamp: z.number(),
    duration_ms: z.number(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    recording_url: z.string().url().optional(),
    transcript: z.string().optional(),
    transcript_object: z.array(RetellTranscriptTurnSchema).optional(),
    call_analysis: z.record(z.unknown()).optional(),
  }),
});
export type RetellWebhook = z.infer<typeof RetellWebhookSchema>;
