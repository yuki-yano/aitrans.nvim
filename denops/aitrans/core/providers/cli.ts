import type { ChatHistoryEntry } from "../apply_options.ts";
import { is } from "../../deps/unknownutil.ts";
import type { NormalizedChunk } from "../../stream/normalize.ts";

export type CliProvider = "codex-cli" | "claude-cli";

export type CliPayload = {
  system?: string;
  prompt: string;
  chat_history?: ChatHistoryEntry[];
  request: Record<string, unknown>;
};

export type CliProviderHooks = {
  onThreadStarted?: (threadId: string) => void;
  onSessionId?: (sessionId: string) => void;
};

export type CliProviderOptions = {
  provider: CliProvider;
  command: string;
  args: string[];
  env?: Record<string, string>;
  payload?: CliPayload;
  signal?: AbortSignal;
  timeoutMs?: number;
  stopSignal: Deno.Signal;
  hooks?: CliProviderHooks;
  debugLog?: (event: unknown) => void;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isCliProvider(value: string): value is CliProvider {
  return value === "codex-cli" || value === "claude-cli";
}

export async function* executeCliProvider(
  options: CliProviderOptions,
): AsyncGenerator<NormalizedChunk> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(options.command, {
      args: options.args,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: options.env,
    }).spawn();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        `aitrans: CLI command "${options.command}" was not found in PATH`,
      );
    }
    throw err;
  }

  let timedOut = false;
  let aborted = false;
  const abortHandler = () => {
    aborted = true;
    try {
      child.kill(options.stopSignal);
    } catch {
      // ignore
    }
  };
  options.signal?.addEventListener("abort", abortHandler, { once: true });

  const timeoutId = options.timeoutMs
    ? setTimeout(() => {
      timedOut = true;
      try {
        child.kill(options.stopSignal);
      } catch {
        // ignore
      }
    }, options.timeoutMs)
    : undefined;

  const stderrPromise = collectStream(child.stderr);
  try {
    await writePayload(child.stdin, options.payload);
    const reader = child.stdout?.getReader();
    if (!reader) {
      throw new Error("aitrans: CLI stdout is not available");
    }
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line.length === 0) {
            continue;
          }
          const chunk = consumeCliLine(line, options);
          if (chunk) {
            yield chunk;
          }
        }
      }
      if (buffer.trim().length > 0) {
        const chunk = consumeCliLine(buffer.trim(), options);
        if (chunk) {
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const status = await child.status;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const stderrText = await stderrPromise;
    if (timedOut) {
      throw new Error("aitrans: CLI execution timed out");
    }
    if (!status.success && !aborted) {
      const message = stderrText.trim().length > 0
        ? `aitrans: CLI exited with code ${status.code}: ${stderrText.trim()}`
        : `aitrans: CLI exited with code ${status.code}`;
      throw new Error(message);
    }
    if (aborted) {
      throw new Error("aitrans: job stopped");
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener("abort", abortHandler);
  }
}

async function writePayload(
  stdin: WritableStream<Uint8Array> | null | undefined,
  payload?: CliPayload,
): Promise<void> {
  if (!stdin) {
    return;
  }
  const writer = stdin.getWriter();
  try {
    if (payload) {
      const body = JSON.stringify(payload);
      await writer.write(encoder.encode(body));
      await writer.write(encoder.encode("\n"));
    }
  } finally {
    await writer.close();
  }
}

async function collectStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
  const chunks: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  return chunks.join("");
}

function consumeCliLine(
  line: string,
  options: CliProviderOptions,
): NormalizedChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return { text_delta: line };
  }
  options.debugLog?.(parsed);
  if (options.provider === "codex-cli") {
    return mapCodexEvent(parsed, options.hooks);
  }
  return mapClaudeResult(parsed, options.hooks);
}

export function mapCodexEvent(
  payload: unknown,
  hooks?: CliProviderHooks,
): NormalizedChunk | null {
  if (!is.Record(payload) || typeof payload.type !== "string") {
    return null;
  }
  switch (payload.type) {
    case "thread.started":
      if (
        typeof payload.thread_id === "string" && payload.thread_id.length > 0
      ) {
        hooks?.onThreadStarted?.(payload.thread_id);
      }
      return { raw: payload };
    case "item.completed": {
      const item = is.Record(payload.item) ? payload.item : null;
      const itemType = typeof item?.type === "string" ? item.type : undefined;
      const text = typeof item?.text === "string" ? item.text : undefined;
      if (itemType === "agent_message" && text) {
        return { text_delta: text };
      }
      return { raw: payload };
    }
    case "turn.completed": {
      const usage = is.Record(payload.usage) ? payload.usage : null;
      const inputTokens = typeof usage?.input_tokens === "number"
        ? usage.input_tokens
        : typeof usage?.cached_input_tokens === "number"
        ? usage.cached_input_tokens
        : undefined;
      const outputTokens = typeof usage?.output_tokens === "number"
        ? usage.output_tokens
        : undefined;
      const chunk: NormalizedChunk = { done: true };
      if (inputTokens != null || outputTokens != null) {
        chunk.usage_partial = {
          input: inputTokens ?? undefined,
          output: outputTokens ?? undefined,
        };
      }
      return chunk;
    }
    default:
      return { raw: payload };
  }
}

export function mapClaudeResult(
  payload: unknown,
  hooks?: CliProviderHooks,
): NormalizedChunk | null {
  if (!is.Record(payload) || payload.type !== "result") {
    return null;
  }
  const chunk: NormalizedChunk = { done: true };
  if (typeof payload.result === "string" && payload.result.length > 0) {
    chunk.text_delta = payload.result;
  }
  const usage = is.Record(payload.usage) ? payload.usage : null;
  const inputTokens = typeof usage?.input_tokens === "number"
    ? usage.input_tokens
    : typeof usage?.cache_creation_input_tokens === "number"
    ? usage.cache_creation_input_tokens
    : undefined;
  const outputTokens = typeof usage?.output_tokens === "number"
    ? usage.output_tokens
    : undefined;
  if (inputTokens != null || outputTokens != null) {
    chunk.usage_partial = {
      input: inputTokens ?? undefined,
      output: outputTokens ?? undefined,
    };
  }
  if (typeof payload.session_id === "string" && payload.session_id.length > 0) {
    hooks?.onSessionId?.(payload.session_id);
  }
  if (!chunk.text_delta && !chunk.usage_partial) {
    chunk.raw = payload;
  }
  return chunk;
}
