import {
  normalizeChunk,
  type NormalizedChunk,
} from "../../stream/normalize.ts";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderExecuteOptions = {
  provider: "openai" | "claude" | "gemini";
  apiKey: string;
  model: string;
  messages: Message[];
  requestArgs?: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const decoder = new TextDecoder();

export async function* executeProvider(
  options: ProviderExecuteOptions,
): AsyncGenerator<NormalizedChunk> {
  switch (options.provider) {
    case "openai":
      yield* executeOpenAI(options);
      return;
    case "claude":
      yield* executeClaude(options);
      return;
    case "gemini":
      yield* executeGemini(options);
      return;
    default:
      throw new Error(`Unsupported provider: ${options.provider}`);
  }
}

async function* executeOpenAI(options: ProviderExecuteOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${options.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      input: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      ...options.requestArgs,
    }),
  });
  ensureOk(response);
  yield* readSSE(response, "openai");
}

async function* executeClaude(options: ProviderExecuteOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      ...options.requestArgs,
    }),
  });
  ensureOk(response);
  yield* readSSE(response, "claude");
}

async function* executeGemini(options: ProviderExecuteOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?key=${options.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        contents: options.messages.map((message) => ({
          role: message.role,
          parts: [{ text: message.content }],
        })),
        generationConfig: options.requestArgs ?? {},
      }),
    },
  );
  ensureOk(response);
  if (!response.body) {
    throw new Error("Gemini response body is empty");
  }
  const reader = response.body.getReader();
  let buffer = "";
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
      const json = JSON.parse(line);
      const normalized = normalizeChunk({ provider: "gemini", ...json });
      if (normalized) {
        yield normalized;
      }
    }
  }
  if (buffer.trim().length > 0) {
    const json = JSON.parse(buffer.trim());
    const normalized = normalizeChunk({ provider: "gemini", ...json });
    if (normalized) {
      yield normalized;
    }
  }
}

function ensureOk(response: Response) {
  if (!response.ok) {
    throw new Error(
      `Provider request failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function* readSSE(response: Response, provider: "openai" | "claude") {
  if (!response.body) {
    throw new Error("Missing response body");
  }
  const reader = response.body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = parseSSEChunk(chunk);
      if (!data) {
        continue;
      }
      const normalized = normalizeChunk({ provider, ...data });
      if (normalized) {
        yield normalized;
      }
    }
  }
}

function parseSSEChunk(chunk: string): Record<string, unknown> | null {
  const lines = chunk.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  if (dataLines.length === 0) {
    return null;
  }
  const json = dataLines.join("");
  return JSON.parse(json);
}
