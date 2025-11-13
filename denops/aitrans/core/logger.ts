import { store } from "../store/index.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

export async function logMessage(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const runtime = store.getState().config.runtime;
  const debugEnabled = runtime?.globals?.debug === true;
  if (level === "debug" && !debugEnabled) {
    return;
  }
  const payload = meta ? `${message} ${JSON.stringify(meta)}` : message;
  console.log(`[${level.toUpperCase()}] ${payload}`);
}

export async function logDebug(
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await logMessage("debug", message, meta);
}
