import type { Denops } from "./deps/denops.ts";
import { is } from "./deps/unknownutil.ts";
import {
  buildMessages,
  ensureApplyOptions,
  resolveProviderKey,
  type ApplyOptions,
  type OutputMode,
  type Provider,
} from "./core/apply_options.ts";
import {
  ensureConfig,
  type RuntimeConfig,
  type TemplateMetadata,
  type FollowUpConfig,
} from "./core/config.ts";
import {
  buildContext,
  type ApplyCallOptions as ContextOptions,
  type TemplateContext,
} from "./core/context.ts";
import { findTemplateMetadata, runTemplateBuilder } from "./core/template.ts";
import {
  createOutputSession,
  type OutputSession,
  type ScratchSplit,
} from "./core/output.ts";
import { executeProvider } from "./core/providers/index.ts";
import { logDebug } from "./core/logger.ts";
import {
  applyFollowUp,
  closeChat,
  createChatOutputSession,
  appendUserMessageToChat,
  listChatHistory,
  listChatLogs,
  loadChatLog,
  openChat,
  resumeChat,
  saveChatLog,
  setFollowUps,
  submitChat,
} from "./chat/controller.ts";
import type { ChatOutputSession } from "./chat/controller.ts";
import { configActions, dispatch, store } from "./store/index.ts";
import {
  closeComposeEditor,
  openComposeEditor,
  readComposeBody,
  resolveComposeConfig,
  type ComposeEditorConfig,
} from "./compose/controller.ts";
import { buildComposeBodyLines } from "./compose/body.ts";

type JobStatus = "pending" | "streaming" | "applied" | "error" | "stopped";

type JobRecord = {
  id: string;
  status: JobStatus;
  controller: AbortController;
};

type JobOutputSession = OutputSession | ChatOutputSession;

type ExecutionPlan = {
  provider: Provider;
  model?: string;
  out: OutputMode;
  register: string;
  requestArgs: Record<string, unknown>;
  followUp: boolean;
};

type ComposeSessionSummary = {
  id: string;
  bufnr: number;
  winid: number;
  header_lines: number;
};

type ComposeCallState = {
  session?: ComposeSessionSummary;
  callOpts: ApplyCallOptions;
  systemPrompt?: string;
  config: ComposeEditorConfig;
};

const jobs = new Map<string, JobRecord>();
let composeState: ComposeCallState | null = null;

export const main = async (denops: Denops): Promise<void> => {
  denops.dispatcher = {
    updateConfig: async (payload: unknown): Promise<void> => {
      const config = ensureConfig(payload);
      dispatch(configActions.setRuntimeConfig(config));
    },
    currentConfig: async () => {
      return store.getState().config.runtime;
    },
    chatOpen: async (payload?: unknown): Promise<void> => {
      await openChat(denops, payload);
    },
    chatSubmit: async (): Promise<JobSummary | null> => {
      return await handleChatSubmit(denops);
    },
    chatApplyFollowUp: async (payload?: unknown): Promise<void> => {
      await applyFollowUp(denops, payload);
    },
    chatSetFollowUps: async (payload?: unknown): Promise<void> => {
      await setFollowUps(denops, payload);
    },
    chatClose: async (): Promise<void> => {
      await closeChat(denops);
    },
    chatListSessions: async (): Promise<Array<unknown>> => {
      return listChatHistory();
    },
    chatResume: async (payload?: unknown): Promise<void> => {
      await resumeChat(denops, payload);
    },
    chatListLogs: async (): Promise<Array<unknown>> => {
      return await listChatLogs(denops);
    },
    chatSave: async (payload?: unknown): Promise<void> => {
      await saveChatLog(denops, payload);
    },
    chatLoad: async (payload?: unknown): Promise<void> => {
      await loadChatLog(denops, payload);
    },
    composeOpen: async (payload?: unknown): Promise<ComposeSessionSummary> => {
      return await handleComposeOpen(denops, payload);
    },
    composeSubmit: async (): Promise<JobSummary | null> => {
      return await handleComposeSubmit(denops);
    },
    composeClose: async (): Promise<void> => {
      await handleComposeClose(denops);
    },
    apply: async (payload?: unknown): Promise<JobSummary> => {
      return await handleApplyRequest(denops, payload);
    },
    stopJob: async (payload?: unknown): Promise<boolean> => {
      return await stopJob(payload);
    },
  };
};

type JobSummary = {
  id: string;
  status: JobStatus;
  out: string;
};

type ApplyCallOptions = ContextOptions & {
  template?: string;
  prompt_override?: string;
  system_override?: string;
  provider?: string;
  model?: string;
  out?: string;
  register?: string;
  args?: Record<string, unknown>;
  request_args_json?: Record<string, unknown>;
  follow_up?: boolean;
};

async function handleApplyRequest(
  denops: Denops,
  payload: unknown,
): Promise<JobSummary> {
  const callOpts = ensureApplyCallOptions(payload);
  const runtime = store.getState().config.runtime;
  if (!runtime) {
    throw new Error("aitrans: runtime config is not available");
  }
  const ctx = await buildContext(denops, callOpts);
  const template = findTemplateMetadata(runtime.templates ?? [], callOpts.template);
  const prompt = await resolvePromptBlock(denops, callOpts, ctx);
  const execution = resolveExecutionPlan(callOpts, template, runtime);
  const finalOptions = ensureApplyOptions({
    prompt: prompt.prompt,
    system: callOpts.system_override ?? prompt.system,
    provider: execution.provider,
    model: execution.model,
    out: execution.out,
    request_args_json: execution.requestArgs,
  });
  await logDebug(denops, "aitrans.apply.plan", {
    provider: execution.provider,
    out: execution.out,
  });

  const session = await createSessionForOutput(
    denops,
    finalOptions,
    ctx,
    runtime,
    execution,
    callOpts,
  );
  if (finalOptions.out === "chat") {
    await ensureChatPromptLogged(denops, finalOptions.prompt);
    const activeChat = store.getState().chat.session;
    if (activeChat) {
      finalOptions.chat_history = [...activeChat.messages];
    }
  }
  return await startApplyJob(denops, finalOptions, runtime, session);
}

async function handleComposeOpen(
  denops: Denops,
  payload: unknown,
): Promise<ComposeSessionSummary> {
  const runtime = store.getState().config.runtime;
  if (!runtime) {
    throw new Error("aitrans: runtime config is not available");
  }
  const callOpts = ensureApplyCallOptions(payload);
  const ctx = await buildContext(denops, callOpts);
  const template = findTemplateMetadata(runtime.templates ?? [], callOpts.template);
  const execution = resolveExecutionPlan(callOpts, template, runtime);
  const prompt = await resolveComposePrompt(denops, callOpts, ctx);
  const config = resolveComposeConfig(runtime.compose);
  const session = await openComposeEditor(denops, {
    header: {
      template: callOpts.template ?? template?.id,
      provider: execution.provider,
      out: execution.out,
      model: execution.model ?? runtime.providers?.[execution.provider]?.model,
    },
    bodyLines: buildComposeBodyLines(prompt.prompt, ctx),
    config,
  });
  composeState = {
    session: {
      id: session.id,
      bufnr: session.bufnr,
      winid: session.winid,
      header_lines: session.headerLines,
    },
    callOpts: {
      ...callOpts,
      provider: execution.provider,
      model: execution.model,
      out: execution.out,
      request_args_json: execution.requestArgs,
    },
    systemPrompt: prompt.system,
    config,
  };
  return composeState.session!;
}

async function handleComposeSubmit(
  denops: Denops,
): Promise<JobSummary | null> {
  if (!composeState) {
    throw new Error("aitrans: compose session is not active");
  }
  const prompt = await readComposeBody(denops);
  if (prompt.trim().length === 0) {
    throw new Error("aitrans: compose buffer is empty");
  }
  const payload: ApplyCallOptions = {
    ...composeState.callOpts,
    prompt_override: prompt,
    system_override: composeState.systemPrompt ?? composeState.callOpts.system_override,
  };
  const result = await handleApplyRequest(denops, payload);
  if (composeState?.config.ui === "float") {
    await handleComposeClose(denops);
  }
  return result;
}

async function handleComposeClose(denops: Denops): Promise<void> {
  await closeComposeEditor(denops);
  composeState = null;
}

async function handleChatSubmit(
  denops: Denops,
): Promise<JobSummary | null> {
  const promptText = await submitChat(denops);
  if (promptText == null) {
    return null;
  }
  const session = store.getState().chat.session;
  if (!session) {
    throw new Error("aitrans: chat session is not active");
  }
  await appendUserMessageToChat(denops, session, promptText);
  const payload: ApplyCallOptions = {
    template: session.template ?? undefined,
    provider: session.provider ?? undefined,
    out: "chat",
    prompt_override: promptText,
    selection: promptText,
    source: "selection",
  };
  return await handleApplyRequest(denops, payload);
}

async function ensureChatPromptLogged(
  denops: Denops,
  promptText: string,
): Promise<void> {
  const session = store.getState().chat.session;
  if (!session) {
    return;
  }
  const last = session.messages.at(-1);
  if (!last || last.role !== "user" || last.content !== promptText) {
    await appendUserMessageToChat(denops, session, promptText);
  }
}

async function startApplyJob(
  denops: Denops,
  options: ApplyOptions,
  runtime: RuntimeConfig,
  session: JobOutputSession,
): Promise<JobSummary> {
  const providerDef = runtime.providers[options.provider] ?? {};
  const model = options.model ?? providerDef.model;
  if (!model) {
    throw new Error("aitrans: model is not specified");
  }
  const apiKey = resolveProviderKey(options.provider);
  if (!apiKey) {
    throw new Error(`aitrans: API key for ${options.provider} is not set`);
  }
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  const record: JobRecord = {
    id: jobId,
    status: "pending",
    controller,
  };
  jobs.set(jobId, record);

  const requestArgs = {
    ...(providerDef.args ?? {}),
    ...(options.request_args_json ?? {}),
  };

  const messages = buildMessages(options);

  runJob({
    job: record,
    denops,
    session,
    providerOptions: {
      provider: options.provider,
      apiKey,
      model,
      messages,
      requestArgs,
      signal: controller.signal,
    },
  });

  return { id: jobId, status: record.status, out: options.out };
}

type RunJobOptions = {
  job: JobRecord;
  denops: Denops;
  session: JobOutputSession;
  providerOptions: Parameters<typeof executeProvider>[0];
};

function runJob(options: RunJobOptions): void {
  const { job, denops, session, providerOptions } = options;
  (async () => {
    try {
      job.status = "streaming";
      for await (const chunk of executeProvider(providerOptions)) {
        if (chunk.text_delta) {
          await session.append(chunk.text_delta);
        }
      }
      await session.finalize();
      job.status = "applied";
    } catch (err) {
      if (job.controller.signal.aborted) {
        job.status = "stopped";
        await session.fail("Job stopped");
        await logDebug(denops, "aitrans.apply.stopped", { id: job.id });
      } else {
        job.status = "error";
        await session.fail(err);
        await logDebug(denops, "aitrans.apply.error", {
          id: job.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      jobs.set(job.id, job);
    }
  })();
}

async function stopJob(payload: unknown): Promise<boolean> {
  if (!is.Record(payload) || typeof payload.id !== "string") {
    return false;
  }
  const job = jobs.get(payload.id);
  if (!job) {
    return false;
  }
  job.controller.abort();
  job.status = "stopped";
  jobs.set(job.id, job);
  return true;
}

function ensureApplyCallOptions(payload: unknown): ApplyCallOptions {
  if (!is.Record(payload)) {
    return {};
  }
  return {
    template: asOptionalString(payload.template),
    prompt_override: asOptionalString(payload.prompt_override),
    system_override: asOptionalString(payload.system_override),
    provider: asOptionalString(payload.provider),
    model: asOptionalString(payload.model),
    out: asOptionalString(payload.out),
    selection: asOptionalString(payload.selection),
    source: asOptionalString(payload.source),
    register: asOptionalString(payload.register),
    range: isRangeTuple(payload.range) ? [payload.range[0], payload.range[1]] : undefined,
    args: is.Record(payload.args) ? payload.args as Record<string, unknown> : undefined,
    request_args_json: is.Record(payload.request_args_json)
      ? payload.request_args_json as Record<string, unknown>
      : undefined,
    follow_up: typeof payload.follow_up === "boolean" ? payload.follow_up : undefined,
  };
}

const isRangeTuple = is.TupleOf([is.Number, is.Number]);

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function resolvePromptBlock(
  denops: Denops,
  opts: ApplyCallOptions,
  ctx: Awaited<ReturnType<typeof buildContext>>,
): Promise<{ prompt: string; system?: string }> {
  if (opts.prompt_override) {
    return {
      prompt: opts.prompt_override.trim(),
      system: opts.system_override,
    };
  }
  if (opts.template) {
    const args = opts.args ?? {};
    const result = await runTemplateBuilder(denops, opts.template, ctx, args);
    return {
      prompt: result.prompt.trim(),
      system: result.system,
    };
  }
  throw new Error("aitrans: template or prompt_override is required");
}

async function resolveComposePrompt(
  denops: Denops,
  opts: ApplyCallOptions,
  ctx: Awaited<ReturnType<typeof buildContext>>,
): Promise<{ prompt: string; system?: string }> {
  if (opts.prompt_override) {
    return {
      prompt: opts.prompt_override.trim(),
      system: opts.system_override,
    };
  }
  if (opts.template) {
    const args = opts.args ?? {};
    const result = await runTemplateBuilder(denops, opts.template, ctx, args);
    return {
      prompt: result.prompt.trim(),
      system: result.system,
    };
  }
  return {
    prompt: (ctx.selection ?? "").trim(),
    system: opts.system_override,
  };
}

function resolveExecutionPlan(
  opts: ApplyCallOptions,
  template: TemplateMetadata | null,
  runtime: RuntimeConfig,
): ExecutionPlan {
  const provider = normalizeProvider(
    opts.provider ?? template?.default_provider ?? firstProvider(runtime) ?? "openai",
  );
  const out = normalizeOut(opts.out ?? template?.default_out ?? "scratch");
  const requestArgs = deepMerge(
    template?.default_request_args_json ?? {},
    opts.request_args_json ?? {},
  );
  const model = opts.model ?? template?.default_model ?? runtime.providers?.[provider]?.model;
  const register = opts.register ?? asOptionalString(runtime.globals?.register) ?? '"';
  let followUpConfig: FollowUpConfig | null = null;
  if (typeof template?.follow_up === "boolean") {
    followUpConfig = { enabled: template.follow_up };
  } else if (template?.follow_up && typeof template.follow_up === "object") {
    followUpConfig = template.follow_up as FollowUpConfig;
  }
  const followUp = typeof opts.follow_up === "boolean"
    ? opts.follow_up
    : (followUpConfig?.enabled === true);
  return { provider, model, out, requestArgs, register, followUp };
}

function normalizeProvider(value: string): Provider {
  if (value === "claude" || value === "gemini") {
    return value;
  }
  return "openai";
}

function normalizeOut(value: string | undefined): OutputMode {
  if (value === "replace" || value === "append" || value === "register" || value === "scratch" || value === "chat") {
    return value;
  }
  return "scratch";
}

function firstProvider(runtime: RuntimeConfig): string | undefined {
  const entries = Object.keys(runtime.providers ?? {});
  return entries[0];
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (is.Record(value) && is.Record(current)) {
      result[key] = deepMerge(current as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function createSessionForOutput(
  denops: Denops,
  options: ApplyOptions,
  ctx: TemplateContext,
  runtime: RuntimeConfig,
  plan: ExecutionPlan,
  callOpts: ApplyCallOptions,
): Promise<JobOutputSession> {
  if (options.out === "chat") {
    if (!store.getState().chat.session) {
      await openChat(denops, {
        template: callOpts.template,
        provider: options.provider,
        follow_up: plan.followUp,
        selection_lines: ctx.selection_lines,
        range: [ctx.start_pos.row, ctx.end_pos.row],
        source_bufnr: ctx.bufnr,
      });
    }
    await ensureChatPromptLogged(denops, options.prompt);
    const activeChat = store.getState().chat.session;
    if (activeChat) {
      options.chat_history = [...activeChat.messages];
    }
    return await createChatOutputSession(denops);
  }
  return await createOutputSession(denops, {
    mode: options.out as Exclude<OutputMode, "chat">,
    ctx,
    register: plan.register,
    scratchSplit: normalizeScratchSplit(runtime.globals?.scratch_split),
  });
}

function normalizeScratchSplit(value: unknown): ScratchSplit {
  if (value === "vertical" || value === "tab" || value === "float") {
    return value;
  }
  return "horizontal";
}
