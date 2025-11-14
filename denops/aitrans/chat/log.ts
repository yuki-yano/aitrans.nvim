import { join } from "../deps/std_path.ts";
import { Denops, fn } from "../deps/denops.ts";
import type { ChatSessionState, FollowUpItem } from "../store/chat.ts";
import { store } from "../store/index.ts";

const SAFE_NAME = /[^a-zA-Z0-9-_]+/g;

export type ChatLogRecord = {
  id: string;
  template?: string;
  provider?: string;
  follow_up_enabled: boolean;
  followups: FollowUpItem[];
  prompt_text: string;
  response_text: string;
  created_at: string;
  provider_context?: ChatSessionState["providerContext"];
};

export type ChatLogSummary = {
  name: string;
  path: string;
  created_at: string;
  template?: string;
  provider?: string;
};

export function sanitizeLogName(input: string | null | undefined): string {
  const base = (input ?? "").trim().replace(SAFE_NAME, "-");
  const sanitized = base.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized : "untitled";
}

export async function listChatLogs(
  denops: Denops,
): Promise<ChatLogSummary[]> {
  const dir = await resolveLogDir(denops);
  const summaries: ChatLogSummary[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        continue;
      }
      const path = join(dir, entry.name);
      try {
        const data = JSON.parse(await Deno.readTextFile(path)) as ChatLogRecord;
        summaries.push({
          name: entry.name.replace(/\.json$/, ""),
          path,
          created_at: data.created_at,
          template: data.template,
          provider: data.provider,
        });
      } catch {
        // ignore malformed entries
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
  return summaries.sort((a, b) => a.created_at < b.created_at ? 1 : -1);
}

export async function saveChatLog(
  denops: Denops,
  session: ChatSessionState,
  payload: unknown,
): Promise<void> {
  const logDir = await resolveLogDir(denops);
  await Deno.mkdir(logDir, { recursive: true });
  const promptText = await readBufferText(denops, session.prompt.bufnr);
  const responseText = await readBufferText(denops, session.response.bufnr);
  const baseName = resolveLogName(payload, session.id);
  const timestamp = new Date().toISOString();
  const record: ChatLogRecord = {
    id: session.id,
    template: session.template,
    provider: session.provider,
    follow_up_enabled: session.followUpEnabled,
    followups: session.followups,
    prompt_text: promptText,
    response_text: responseText,
    created_at: timestamp,
    provider_context: session.providerContext,
  };
  const jsonPath = join(logDir, `${baseName}.json`);
  const markdownPath = join(logDir, `${baseName}.md`);
  await Deno.writeTextFile(jsonPath, JSON.stringify(record, null, 2));
  await Deno.writeTextFile(markdownPath, renderMarkdownLog(record));
}

export async function loadChatLog(
  denops: Denops,
  payload: unknown,
): Promise<ChatLogRecord> {
  const target = await resolveLogPath(denops, payload);
  return JSON.parse(await Deno.readTextFile(target)) as ChatLogRecord;
}

function getRuntimeConfig() {
  return store.getState().config.runtime;
}

async function resolveLogDir(denops: Denops): Promise<string> {
  const runtime = getRuntimeConfig();
  const raw = typeof runtime?.chat?.log_dir === "string" &&
      runtime.chat.log_dir.length > 0
    ? runtime.chat.log_dir
    : "~/.cache/vim/aitrans";
  const expanded = await fn.expand(denops, raw) as string;
  return expanded;
}

function resolveLogName(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return sanitizeLogName(payload);
  }
  if (isLogNamePayload(payload)) {
    return sanitizeLogName(payload.name);
  }
  if (fallback && fallback.length > 0) {
    return sanitizeLogName(fallback);
  }
  return sanitizeLogName(new Date().toISOString());
}

async function resolveLogPath(
  denops: Denops,
  payload: unknown,
): Promise<string> {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (
      trimmed.length > 0 && (trimmed.includes("/") || trimmed.includes("\\"))
    ) {
      return trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
    }
    if (trimmed.endsWith(".json")) {
      return trimmed;
    }
  }
  let name: string | undefined;
  let path: string | undefined;
  if (typeof payload === "string" && payload.trim().length > 0) {
    name = payload.trim();
  } else if (isLogPathPayload(payload)) {
    path = payload.path;
    name = payload.name;
  }
  if (path) {
    return path;
  }
  const logDir = await resolveLogDir(denops);
  const base = sanitizeLogName(name ?? "latest");
  return join(logDir, base.endsWith(".json") ? base : `${base}.json`);
}

async function readBufferText(
  denops: Denops,
  bufnr: number,
): Promise<string> {
  const lines = await fn.getbufline(denops, bufnr, 1, "$") as string[];
  return lines.join("\n").trimEnd();
}

function renderMarkdownLog(record: ChatLogRecord): string {
  const lines = [
    `# Aitrans Chat Log (${record.created_at})`,
    ``,
    `- Template: ${record.template ?? "n/a"}`,
    `- Provider: ${record.provider ?? "auto"}`,
    `- Follow-up Enabled: ${record.follow_up_enabled}`,
    ``,
    "## Prompt",
    record.prompt_text,
    "",
    "## Response",
    record.response_text,
    "",
    "## Follow-ups",
  ];
  if (record.followups.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of record.followups) {
      lines.push(`- [${item.key}] ${item.text}`);
    }
  }
  return lines.join("\n");
}

const isLogNamePayload = (value: unknown): value is { name: string } => {
  return typeof value === "object" && value != null &&
    typeof (value as { name?: unknown }).name === "string";
};

const isLogPathPayload = (
  value: unknown,
): value is { path?: string; name?: string } => {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const payload = value as { path?: unknown; name?: unknown };
  return (
    typeof payload.path === "string" ||
    typeof payload.name === "string"
  );
};
