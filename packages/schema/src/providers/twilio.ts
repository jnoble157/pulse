import { z } from 'zod';

export const TwilioRecordingWebhookSchema = z.object({
  AccountSid: z.string(),
  CallSid: z.string(),
  RecordingSid: z.string(),
  RecordingUrl: z.string().url(),
  RecordingDuration: z.string(),
  RecordingStatus: z.enum(['completed', 'in-progress', 'failed']),
  From: z.string().optional(),
  To: z.string().optional(),
});
export type TwilioRecordingWebhook = z.infer<typeof TwilioRecordingWebhookSchema>;
