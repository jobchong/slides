type LogContext = Record<string, unknown>;

export function nowUtc(): string {
  return new Date().toISOString();
}

function shouldLog(): boolean {
  return (
    process.env.SLIDEAI_SILENCE_LOGS !== "true" &&
    process.env.NODE_ENV !== "test" &&
    process.env.BUN_ENV !== "test"
  );
}

export function logInfo(message: string, context?: LogContext) {
  if (!shouldLog()) return;
  if (context) {
    console.info(`[${nowUtc()}] ${message}`, context);
    return;
  }
  console.info(`[${nowUtc()}] ${message}`);
}

export function logWarn(message: string, context?: LogContext) {
  if (!shouldLog()) return;
  if (context) {
    console.warn(`[${nowUtc()}] ${message}`, context);
    return;
  }
  console.warn(`[${nowUtc()}] ${message}`);
}

export function logError(message: string, context?: LogContext) {
  if (!shouldLog()) return;
  if (context) {
    console.error(`[${nowUtc()}] ${message}`, context);
    return;
  }
  console.error(`[${nowUtc()}] ${message}`);
}

export function preview(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
