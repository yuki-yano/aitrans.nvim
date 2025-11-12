import type { Denops } from "../deps/denops.ts";
import { store } from "../store/index.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

export async function logMessage(
  denops: Denops,
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
  if (hasLogger(denops)) {
    denops.log(level, "[aitrans]", payload);
    return;
  }
  try {
    await denops.call("denops#util#print_error", `[aitrans/${level}] ${payload}`);
  } catch {
    // ignore fallback failures
  }
}

export async function logDebug(
  denops: Denops,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await logMessage(denops, "debug", message, meta);
}

function hasLogger(
  denops: Denops,
): denops is Denops & { log: (level: LogLevel, ...args: unknown[]) => void } {
  return typeof (denops as { log?: unknown }).log === "function";
}
