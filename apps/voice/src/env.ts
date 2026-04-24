/**
 * Env validation for the voice agent. Crashes early on missing keys so a
 * misconfigured deploy fails on boot rather than mid-call.
 */
import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(8788),
  /**
   * Twilio fetches `/twilio/voice` and opens a WebSocket to `/twilio/media`
   * against this host. For real PSTN you need an https URL (ngrok, etc.).
   * Default is local only: outbound Twilio will not reach it until you set
   * a public URL and restart.
   */
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:8788')
    .describe('Public base URL Twilio reaches (ngrok in prod-like demos)'),
  ANTHROPIC_API_KEY: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_MODEL: z.string().default('eleven_flash_v2_5'),
  /**
   * Web app base URL the agent posts live transcript events to so the
   * homepage shows the call in real time. Optional — agent still answers
   * callers if this is unset; the homepage just won't update.
   */
  WEB_BASE_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:3000')
    .describe('Next.js origin for POST /api/calls/live/push (live transcript on /)'),
  /** Bearer token verified by the web app's `/api/calls/live/push`. */
  LIVE_CALLS_PUSH_TOKEN: z.string().min(1).optional(),
  PULSE_TENANT_SLUG: z.string().default('tonys-pizza-austin'),
  AGENT_MODEL: z
    .enum(['claude-sonnet-4-5', 'claude-haiku-4-5'])
    .default('claude-sonnet-4-5'),
});

export type VoiceEnv = z.infer<typeof Schema>;

let cached: VoiceEnv | null = null;
export function env(): VoiceEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    console.error('[voice] env validation failed:', JSON.stringify(issues, null, 2));
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
