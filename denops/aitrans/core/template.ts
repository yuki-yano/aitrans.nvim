import { Denops } from "../deps/denops.ts";
import { is } from "../deps/unknownutil.ts";
import type { Position, TemplateContext } from "./context.ts";
import type { TemplateMetadata } from "./config.ts";
import type {
  ApplyOptions,
  ChatHistoryEntry,
  OutputMode,
  Provider,
} from "./apply_options.ts";

export type PromptBlock = {
  prompt: string;
  system?: string;
};

export async function runTemplateBuilder(
  denops: Denops,
  templateId: string,
  ctx: TemplateContext,
  args: Record<string, unknown>,
): Promise<PromptBlock> {
  const result = await denops.call(
    "aitrans#template#execute",
    templateId,
    ctx,
    args,
  );
  if (typeof result === "string") {
    return { prompt: result };
  }
  if (is.Record(result) && typeof result.prompt === "string") {
    return {
      prompt: result.prompt,
      system: typeof result.system === "string" ? result.system : undefined,
    };
  }
  throw new Error(`aitrans: template "${templateId}" returned invalid result`);
}

export function findTemplateMetadata(
  templates: TemplateMetadata[],
  templateId?: string,
): TemplateMetadata | null {
  if (!templateId) {
    return null;
  }
  return templates.find((entry) => entry.id === templateId) ?? null;
}

export async function runTemplateCallback(
  denops: Denops,
  templateId: string | null | undefined,
  ctx: TemplateCompletionContext,
): Promise<void> {
  if (!templateId) {
    return;
  }
  await denops.call("aitrans#template#run_callback", templateId, ctx);
}

export type TemplateCompletionUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export type TemplateCompletionTarget =
  | {
    type: "replace";
    bufnr: number;
    range: { start: Position; end: Position };
  }
  | {
    type: "append";
    bufnr: number;
    position: Position;
  }
  | {
    type: "register";
    register: string;
  }
  | {
    type: "scratch";
  }
  | {
    type: "chat";
    session_id?: string | null;
  }
  | {
    type: "unknown";
  };

export type TemplateCompletionContext = {
  template?: { id: string; title?: string };
  provider: Provider;
  model?: string;
  prompt: string;
  system?: string;
  request_args: Record<string, unknown>;
  chat_history?: ChatHistoryEntry[];
  out: OutputMode;
  response: {
    text: string;
    chunks: string[];
  };
  usage?: TemplateCompletionUsage;
  job: {
    id: string;
  };
  target: TemplateCompletionTarget;
  source_ctx: TemplateContext;
  diagnostics?: TemplateContext["diagnostics"];
  completed_at: number;
};

export function buildTemplateCompletionContext(args: {
  templateMeta?: TemplateMetadata | null;
  templateId?: string | null;
  templateContext: TemplateContext;
  applyOptions: ApplyOptions;
  responseChunks: string[];
  usage?: TemplateCompletionUsage;
  target: TemplateCompletionTarget;
  completedAt: number;
  jobId: string;
}): TemplateCompletionContext {
  const templateInfo = args.templateMeta
    ? { id: args.templateMeta.id, title: args.templateMeta.title }
    : args.templateId
    ? { id: args.templateId }
    : undefined;
  const text = args.responseChunks.join("");
  return {
    template: templateInfo,
    provider: args.applyOptions.provider,
    model: args.applyOptions.model,
    prompt: args.applyOptions.prompt,
    system: args.applyOptions.system,
    request_args: args.applyOptions.request_args_json ?? {},
    chat_history: args.applyOptions.chat_history,
    out: args.applyOptions.out,
    response: { text, chunks: [...args.responseChunks] },
    usage: args.usage,
    job: { id: args.jobId },
    target: args.target,
    source_ctx: args.templateContext,
    diagnostics: args.templateContext.diagnostics,
    completed_at: args.completedAt,
  };
}
