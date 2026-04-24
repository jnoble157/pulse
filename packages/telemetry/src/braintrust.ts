/**
 * Braintrust logging hook (ADR-011).
 *
 * Best-effort. If BRAINTRUST_API_KEY isn't set, this is a no-op. The LLM
 * call itself never fails because Braintrust is down; we just log locally.
 */
import { logger } from './logger.js';

type BraintrustSdk = {
  initLogger: (opts: { projectName: string; apiKey: string }) => BraintrustProject;
};
type BraintrustProject = {
  log: (args: Record<string, unknown>) => void;
};

let braintrust: BraintrustSdk | null = null;
let project: BraintrustProject | null = null;

async function getBraintrust() {
  if (!process.env.BRAINTRUST_API_KEY) return null;
  if (braintrust) return braintrust;
  try {
    braintrust = await import('braintrust');
    const projectName = process.env.BRAINTRUST_PROJECT ?? 'pulse';
    project = braintrust.initLogger({ projectName, apiKey: process.env.BRAINTRUST_API_KEY });
    return braintrust;
  } catch (err) {
    logger.warn('braintrust_import_failed', { err: String(err) });
    return null;
  }
}

export async function logBraintrustCall(event: {
  name: string;
  prompt_version: string;
  model: string;
  input: unknown;
  output: unknown;
  metrics: { cost_cents: number; latency_ms: number; input_tokens: number; output_tokens: number };
  metadata?: Record<string, unknown>;
  error?: string;
}) {
  const bt = await getBraintrust();
  if (!bt || !project) return;
  try {
    project.log({
      input: event.input,
      output: event.output,
      metadata: {
        name: event.name,
        prompt_version: event.prompt_version,
        model: event.model,
        ...event.metadata,
      },
      metrics: event.metrics,
      error: event.error,
    });
  } catch (err) {
    logger.warn('braintrust_log_failed', { err: String(err) });
  }
}
