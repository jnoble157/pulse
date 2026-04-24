/**
 * LLM-call error taxonomy. Thrown from llm.call() or surfaced on its result.
 * Upstream (packages/extraction) decides whether to dead-letter or propagate.
 */
export class LlmCallError extends Error {
  constructor(
    message: string,
    readonly detail: {
      kind:
        | 'schema_mismatch'
        | 'malformed_json'
        | 'provider_error'
        | 'timeout'
        | 'rate_limit'
        | 'refusal';
      attempts: number;
      model: string;
      prompt_version: string;
      raw?: unknown;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'LlmCallError';
  }
}
