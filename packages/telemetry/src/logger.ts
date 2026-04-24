/**
 * Minimal structured logger. Wraps console; Axiom OTLP export plugs in later
 * (ADR-011) without changing call sites.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? 'info'] ?? 20;

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  sink(JSON.stringify(record));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  child: (bindings: Record<string, unknown>) => ({
    debug: (msg: string, fields?: Record<string, unknown>) =>
      emit('debug', msg, { ...bindings, ...fields }),
    info: (msg: string, fields?: Record<string, unknown>) =>
      emit('info', msg, { ...bindings, ...fields }),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      emit('warn', msg, { ...bindings, ...fields }),
    error: (msg: string, fields?: Record<string, unknown>) =>
      emit('error', msg, { ...bindings, ...fields }),
  }),
};
