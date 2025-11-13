import { is } from "../deps/unknownutil.ts";

export type ApiProvider = "openai" | "claude" | "gemini";
export type CliProvider = "codex-cli" | "claude-cli";
export type Provider = ApiProvider | CliProvider;
export type OutputMode = "replace" | "append" | "register" | "scratch" | "chat";

export type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ApplyOptions = {
  prompt: string;
  system?: string;
  provider: Provider;
  model?: string;
  out: OutputMode;
  request_args_json?: Record<string, unknown>;
  chat_history?: ChatHistoryEntry[];
};

export type Message = { role: "system" | "user" | "assistant"; content: string };

export function ensureApplyOptions(payload: unknown): ApplyOptions {
  if (!is.Record(payload) || typeof payload.prompt !== "string") {
    throw new Error("aitrans: prompt is required");
  }
  const provider = normalizeProvider(payload.provider);
  const out = normalizeOut(payload.out);
  const system = typeof payload.system === "string" && payload.system.length > 0
    ? payload.system
    : undefined;
  const model = typeof payload.model === "string" && payload.model.length > 0
    ? payload.model
    : undefined;
  const requestArgs = is.Record(payload.request_args_json)
    ? payload.request_args_json as Record<string, unknown>
    : undefined;
  return {
    prompt: payload.prompt,
    system,
    provider,
    model,
    out,
    request_args_json: requestArgs,
  };
}

export function buildMessages(options: ApplyOptions): Message[] {
  const messages: Message[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  const history = options.chat_history ?? [];
  for (const entry of history) {
    messages.push({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content,
    });
  }
  const last = history.at(-1);
  const shouldAppendPrompt = !last ||
    last.role !== "user" ||
    last.content !== options.prompt;
  if (shouldAppendPrompt) {
    messages.push({ role: "user", content: options.prompt });
  }
  return messages;
}

export function resolveProviderKey(provider: Provider): string | null {
  switch (provider) {
    case "openai":
      return Deno.env.get("OPENAI_API_KEY") ?? null;
    case "claude":
      return Deno.env.get("ANTHROPIC_API_KEY") ?? null;
    case "gemini":
      return Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_API_KEY") ?? null;
    case "codex-cli":
    case "claude-cli":
      return null;
    default:
      return null;
  }
}

function normalizeProvider(value: unknown): Provider {
  if (value === "claude" || value === "gemini") {
    return value;
  }
  if (value === "codex-cli" || value === "claude-cli") {
    return value;
  }
  return "openai";
}

function normalizeOut(value: unknown): OutputMode {
  if (value === "replace" || value === "append" || value === "register" || value === "scratch" || value === "chat") {
    return value;
  }
  if (value === undefined) {
    return "scratch";
  }
  throw new Error(`aitrans: output mode "${String(value)}" is not implemented yet`);
}
