export type NormalizedChunk = {
  text_delta?: string;
  done?: boolean;
  usage_partial?: {
    input?: number;
    output?: number;
  };
  raw?: unknown;
};

export function normalizeChunk(payload: unknown): NormalizedChunk | null {
  if (isOpenAIChunk(payload)) {
    return normalizeOpenAI(payload);
  }
  if (isClaudeChunk(payload)) {
    return normalizeClaude(payload);
  }
  if (isGeminiChunk(payload)) {
    return normalizeGemini(payload);
  }
  return null;
}

type OpenAIChunk = {
  provider: "openai";
  type?: string;
  delta?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function isOpenAIChunk(value: unknown): value is OpenAIChunk {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).provider === "openai";
}

function normalizeOpenAI(chunk: OpenAIChunk): NormalizedChunk {
  const result: NormalizedChunk = {};
  if (typeof chunk.delta === "string") {
    result.text_delta = chunk.delta;
  }
  if (chunk.type === "response.completed") {
    result.done = true;
  }
  if (chunk.usage) {
    result.usage_partial = {
      input: chunk.usage.input_tokens,
      output: chunk.usage.output_tokens,
    };
  }
  if (!result.text_delta && !result.done && !result.usage_partial) {
    result.raw = chunk;
  }
  return result;
}

type ClaudeChunk = {
  provider: "claude";
  type: string;
  delta?: { text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
};

function isClaudeChunk(value: unknown): value is ClaudeChunk {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).provider === "claude" &&
    typeof (value as { type?: unknown }).type === "string";
}

function normalizeClaude(chunk: ClaudeChunk): NormalizedChunk {
  const result: NormalizedChunk = {};
  if (chunk.type === "content_block_delta") {
    const text = chunk.delta?.text;
    if (typeof text === "string") {
      result.text_delta = text;
    }
  }
  if (chunk.type === "message_stop") {
    result.done = true;
  }
  if (chunk.usage) {
    result.usage_partial = {
      input: chunk.usage.input_tokens,
      output: chunk.usage.output_tokens,
    };
  }
  if (!result.text_delta && !result.done && !result.usage_partial) {
    result.raw = chunk;
  }
  return result;
}

type GeminiChunk = {
  provider: "gemini";
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

function isGeminiChunk(value: unknown): value is GeminiChunk {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).provider === "gemini";
}

function normalizeGemini(chunk: GeminiChunk): NormalizedChunk {
  const parts = chunk.candidates?.[0]?.content?.parts;
  const text = parts?.map((part) => part.text ?? "").filter(Boolean).join("");
  if (text && text.length > 0) {
    return { text_delta: text };
  }
  return { raw: chunk };
}
