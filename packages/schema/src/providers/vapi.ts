/**
 * Vapi webhook envelope shape. Subset of the real contract — enough for the
 * translator in apps/api/ingest/providers/vapi.ts to reach IngestCallEvent.
 */
import { z } from 'zod';

export const VapiMessageSchema = z.object({
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  message: z.string(),
  time: z.number(),
  secondsFromStart: z.number().optional(),
  duration: z.number().optional(),
});

export const VapiWebhookSchema = z.object({
  message: z.object({
    type: z.literal('end-of-call-report'),
    call: z.object({
      id: z.string(),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime(),
      customer: z
        .object({
          number: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
      phoneNumber: z.object({ number: z.string() }).optional(),
    }),
    transcript: z.string().optional(),
    messages: z.array(VapiMessageSchema).optional(),
    recordingUrl: z.string().url().optional(),
    durationSeconds: z.number().optional(),
  }),
});
export type VapiWebhook = z.infer<typeof VapiWebhookSchema>;
