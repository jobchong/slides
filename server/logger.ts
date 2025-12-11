type LogContext = Record<string, unknown>;

export function nowUtc(): string {
  return new Date().toISOString();
}

export function logInfo(message: string, context?: LogContext) {
  if (context) {
    console.info(`[${nowUtc()}] ${message}`, context);
    return;
  }
  console.info(`[${nowUtc()}] ${message}`);
}

export function logWarn(message: string, context?: LogContext) {
  if (context) {
    console.warn(`[${nowUtc()}] ${message}`, context);
    return;
  }
  console.warn(`[${nowUtc()}] ${message}`);
}

export function logError(message: string, context?: LogContext) {
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
