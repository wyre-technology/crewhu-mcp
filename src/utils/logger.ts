/**
 * Minimal stderr logger.
 *
 * Important: stdout is reserved for MCP JSON-RPC messages on stdio transport,
 * so all logging writes to stderr. Error objects are serialised explicitly
 * (message + stack + own enumerable props) to avoid the `{ error: {} }`
 * black-hole pattern.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
  return raw in LEVELS ? LEVELS[raw] : LEVELS.info;
}

function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = { message: err.message, name: err.name };
    if (err.stack) out.stack = err.stack;
    for (const k of Object.keys(err)) out[k] = (err as unknown as Record<string, unknown>)[k];
    return out;
  }
  if (typeof err === "object" && err !== null) return err as Record<string, unknown>;
  return { value: String(err) };
}

function normalise(meta: unknown): unknown {
  if (!meta || typeof meta !== "object") return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    out[k] = k === "error" || k === "err" || v instanceof Error ? serialiseError(v) : v;
  }
  return out;
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (LEVELS[level] > currentLevel()) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    process.stderr.write(`${prefix} ${message} ${JSON.stringify(normalise(meta), null, 0)}\n`);
  } else {
    process.stderr.write(`${prefix} ${message}\n`);
  }
}

export const logger = {
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
};
