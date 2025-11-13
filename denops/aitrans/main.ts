import type { Denops } from "./deps/denops.ts";
import { is } from "./deps/unknownutil.ts";
import {
  type ApplyOptions,
  buildMessages,
  ensureApplyOptions,
  type OutputMode,
  type Provider,
  resolveProviderKey,
} from "./core/apply_options.ts";
import {
  ensureConfig,
  type FollowUpConfig,
  type ProviderDefinition,
  type RuntimeConfig,
  type TemplateMetadata,
} from "./core/config.ts";
import {
  type ApplyCallOptions as ContextOptions,
  buildContext,
  type TemplateContext,
} from "./core/context.ts";
import {
  buildTemplateCompletionContext,
  findTemplateMetadata,
  runTemplateBuilder,
  runTemplateCallback,
  type TemplateCompletionTarget,
  type TemplateCompletionUsage,
} from "./core/template.ts";
import {
  createOutputSession,
  type OutputSession,
  type ScratchSplit,
} from "./core/output.ts";
import { executeProvider } from "./core/providers/index.ts";
import {
  type CliPayload,
  type CliProvider,
  executeCliProvider,
  isCliProvider,
} from "./core/providers/cli.ts";
import { logDebug } from "./core/logger.ts";
import type { NormalizedChunk } from "./stream/normalize.ts";
import {
  appendUserMessageToChat,
  applyFollowUp,
  closeChat,
  createChatOutputSession,
  getActiveProviderContext,
  listChatHistory,
  listChatLogs,
  loadChatLog,
  openChat,
  resumeChat,
  saveChatLog,
  setFollowUps,
  submitChat,
  updateChatProviderContext,
} from "./chat/controller.ts";
import type { ChatOutputSession } from "./chat/controller.ts";
import { configActions, dispatch, store } from "./store/index.ts";
import {
  closeComposeEditor,
  type ComposeEditorConfig,
  openComposeEditor,
  readComposeBody,
  resolveComposeConfig,
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
  origin_winid?: number;
};

const jobs = new Map<string, JobRecord>();
let composeState: ComposeCallState | null = null;

export const main = (denops: Denops): void => {
  denops.dispatcher = {
    updateConfig: (payload: unknown): void => {
      const config = ensureConfig(payload);
      dispatch(configActions.setRuntimeConfig(config));
    },
    currentConfig: () => {
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
    chatListSessions: (): Array<unknown> => listChatHistory(),
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
  const runtime = await ensureRuntimeConfigAvailable(denops);
  const ctx = await buildContext(denops, callOpts);
  const template = findTemplateMetadata(
    runtime.templates ?? [],
    callOpts.template,
  );
  const prompt = await resolvePromptBlock(denops, callOpts, ctx);
  const execution = resolveExecutionPlan(callOpts, template, runtime);
  const templateId = callOpts.template ?? template?.id ?? undefined;
  const finalOptions = ensureApplyOptions({
    prompt: prompt.prompt,
    system: callOpts.system_override ?? prompt.system,
    provider: execution.provider,
    model: execution.model,
    out: execution.out,
    request_args_json: execution.requestArgs,
  });
  await logDebug("aitrans.apply.plan", {
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
  let chatSessionId: string | null | undefined = undefined;
  if (finalOptions.out === "chat") {
    await ensureChatPromptLogged(denops, finalOptions.prompt);
    const activeChat = store.getState().chat.session;
    if (activeChat) {
      finalOptions.chat_history = [...activeChat.messages];
      chatSessionId = activeChat.id;
    }
  }
  return startApplyJob(
    denops,
    finalOptions,
    runtime,
    session,
    templateId,
    template,
    ctx,
    execution,
    chatSessionId,
  );
}

async function handleComposeOpen(
  denops: Denops,
  payload: unknown,
): Promise<ComposeSessionSummary> {
  const runtime = await ensureRuntimeConfigAvailable(denops);
  const callOpts = ensureApplyCallOptions(payload);
  const originWinid = await denops.call("nvim_get_current_win") as number;
  const ctx = await buildContext(denops, callOpts);
  const template = findTemplateMetadata(
    runtime.templates ?? [],
    callOpts.template,
  );
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
    origin_winid: originWinid,
  };
  return composeState.session!;
}

async function handleComposeSubmit(
  denops: Denops,
): Promise<JobSummary | null> {
  if (!composeState) {
    throw new Error("aitrans: compose session is not active");
  }
  const state = composeState;
  const prompt = await readComposeBody(denops);
  if (prompt.trim().length === 0) {
    throw new Error("aitrans: compose buffer is empty");
  }
  const payload: ApplyCallOptions = {
    ...state.callOpts,
    prompt_override: prompt,
    system_override: state.systemPrompt ??
      state.callOpts.system_override,
  };
  const shouldClose = state.config.ui === "float";
  const composeWinid = state.session?.winid;
  await focusUsableWindow(denops, state.origin_winid);
  try {
    const result = await handleApplyRequest(denops, payload);
    if (shouldClose) {
      await handleComposeClose(denops);
    } else if (composeWinid) {
      await focusUsableWindow(denops, composeWinid);
    }
    return result;
  } catch (err) {
    if (!shouldClose && composeWinid) {
      await focusUsableWindow(denops, composeWinid);
    }
    throw err;
  }
}

async function handleComposeClose(denops: Denops): Promise<void> {
  await closeComposeEditor(denops);
  composeState = null;
}

async function handleChatSubmit(
  denops: Denops,
): Promise<JobSummary | null> {
  const session = store.getState().chat.session;
  if (!session) {
    throw new Error("aitrans: chat session is not active");
  }
  if (session.streaming) {
    await showWarning(denops, "aitrans: previous response is still streaming");
    return null;
  }
  const promptText = await submitChat(denops);
  if (promptText == null) {
    return null;
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

function startApplyJob(
  denops: Denops,
  options: ApplyOptions,
  runtime: RuntimeConfig,
  session: JobOutputSession,
  templateId: string | null | undefined,
  templateMeta: TemplateMetadata | null,
  templateContext: TemplateContext,
  executionPlan: ExecutionPlan,
  chatSessionId?: string | null,
): JobSummary {
  const providerDef = runtime.providers[options.provider] ?? {};
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  const record: JobRecord = {
    id: jobId,
    status: "pending",
    controller,
  };
  jobs.set(jobId, record);
  const requestArgs = mergeProviderRequestArgs(
    providerDef,
    options.request_args_json,
  );
  const chunkIterator = isCliProvider(options.provider)
    ? buildCliIterator({
      provider: options.provider,
      providerDef,
      options,
      requestArgs,
      controller,
      runtime,
      denops,
    })
    : buildApiIterator({
      provider: options.provider,
      providerDef,
      options,
      requestArgs,
      controller,
    });
  runJob({
    job: record,
    denops,
    session,
    chunkIterator,
    templateId,
    templateMeta,
    templateContext,
    applyOptions: options,
    executionPlan,
    chatSessionId,
  });

  return { id: jobId, status: record.status, out: options.out };
}

type ApiIteratorArgs = {
  provider: Provider;
  providerDef: ProviderDefinition;
  options: ApplyOptions;
  requestArgs: Record<string, unknown>;
  controller: AbortController;
};

function buildApiIterator(
  args: ApiIteratorArgs,
): AsyncGenerator<NormalizedChunk> {
  if (isCliProvider(args.provider)) {
    throw new Error("aitrans: invalid provider configuration");
  }
  const model = args.options.model ?? args.providerDef.model;
  if (!model) {
    throw new Error("aitrans: model is not specified");
  }
  const apiKey = resolveProviderKey(args.provider);
  if (!apiKey) {
    throw new Error(`aitrans: API key for ${args.provider} is not set`);
  }
  const messages = buildMessages(args.options);
  return executeProvider({
    provider: args.provider,
    apiKey,
    model,
    messages,
    requestArgs: args.requestArgs,
    signal: args.controller.signal,
  });
}

type CliIteratorArgs = {
  provider: CliProvider;
  providerDef: ProviderDefinition;
  options: ApplyOptions;
  requestArgs: Record<string, unknown>;
  controller: AbortController;
  runtime: RuntimeConfig;
  denops: Denops;
};

function buildCliIterator(
  args: CliIteratorArgs,
): AsyncGenerator<NormalizedChunk> {
  const command = typeof args.providerDef.command === "string" &&
      args.providerDef.command.length > 0
    ? args.providerDef.command
    : defaultCliCommand(args.provider);
  const baseArgs = resolveCliArgs(args.providerDef);
  const chatContext = args.options.out === "chat"
    ? getActiveProviderContext()
    : null;
  let finalArgs = applyProviderContextToArgs(
    args.provider,
    baseArgs,
    chatContext,
  );
  let payload: CliPayload | undefined = buildCliPayload(
    args.options,
    args.requestArgs,
  );
  const globalTimeout = asOptionalNumber(args.runtime.globals?.timeout_ms);
  const timeoutMs = resolveCliTimeout(args.providerDef, globalTimeout);
  const env = buildCliEnv(args.providerDef);
  const debugEnabled = runtimeDebugEnabled(args.runtime);
  const debugLog = debugEnabled
    ? (event: unknown) => {
      void logDebug("aitrans.cli.event", {
        provider: args.provider,
        event,
      });
    }
    : undefined;
  if (args.provider === "codex-cli" && chatContext?.thread_id) {
    const payloadJson = JSON.stringify(payload);
    finalArgs = [
      "exec",
      "--json",
      payloadJson,
      "resume",
      chatContext.thread_id,
    ];
    payload = undefined;
  }
  const hooks = args.options.out === "chat"
    ? {
      onThreadStarted: (threadId: string) => {
        updateChatProviderContext({
          provider: args.provider,
          thread_id: threadId,
        });
      },
      onSessionId: (sessionId: string) => {
        updateChatProviderContext({
          provider: args.provider,
          session_id: sessionId,
        });
      },
    }
    : undefined;
  return executeCliProvider({
    provider: args.provider,
    command,
    args: finalArgs,
    env,
    payload,
    signal: args.controller.signal,
    timeoutMs,
    stopSignal: cliStopSignal(args.provider),
    hooks,
    debugLog,
  });
}

type RunJobOptions = {
  job: JobRecord;
  denops: Denops;
  session: JobOutputSession;
  chunkIterator: AsyncGenerator<NormalizedChunk>;
  templateId?: string | null;
  templateMeta?: TemplateMetadata | null;
  templateContext: TemplateContext;
  applyOptions: ApplyOptions;
  executionPlan: ExecutionPlan;
  chatSessionId?: string | null;
};

function runJob(options: RunJobOptions): void {
  const {
    job,
    denops,
    session,
    chunkIterator,
    templateId,
    templateMeta,
    templateContext,
    applyOptions,
    executionPlan,
    chatSessionId,
  } = options;
  (async () => {
    try {
      job.status = "streaming";
      const responseChunks: string[] = [];
      let usage: TemplateCompletionUsage | undefined;
      for await (const chunk of chunkIterator) {
        if (chunk.text_delta) {
          responseChunks.push(chunk.text_delta);
          await session.append(chunk.text_delta);
        }
        if (chunk.usage_partial) {
          usage = {
            input_tokens: chunk.usage_partial.input ?? usage?.input_tokens,
            output_tokens: chunk.usage_partial.output ?? usage?.output_tokens,
          };
        }
      }
      await session.finalize();
      if (templateId) {
        try {
          const completionTarget = buildCompletionTarget(
            applyOptions.out,
            templateContext,
            executionPlan,
            chatSessionId,
          );
          const completionCtx = buildTemplateCompletionContext({
            templateMeta,
            templateId,
            templateContext,
            applyOptions,
            responseChunks,
            usage,
            target: completionTarget,
            completedAt: Date.now() / 1000,
            jobId: job.id,
          });
          await runTemplateCallback(denops, templateId, completionCtx);
        } catch (err) {
          await logDebug("aitrans.template.callback.error", {
            id: templateId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      job.status = "applied";
    } catch (err) {
      if (job.controller.signal.aborted) {
        job.status = "stopped";
        await session.fail("Job stopped");
        await logDebug("aitrans.apply.stopped", { id: job.id });
      } else {
        job.status = "error";
        await session.fail(err);
        await logDebug("aitrans.apply.error", {
          id: job.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      jobs.set(job.id, job);
    }
  })();
}

function stopJob(payload: unknown): boolean {
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
    range: isRangeTuple(payload.range)
      ? [payload.range[0], payload.range[1]]
      : undefined,
    args: is.Record(payload.args)
      ? payload.args as Record<string, unknown>
      : undefined,
    request_args_json: is.Record(payload.request_args_json)
      ? payload.request_args_json as Record<string, unknown>
      : undefined,
    follow_up: typeof payload.follow_up === "boolean"
      ? payload.follow_up
      : undefined,
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
    opts.provider ?? template?.default_provider ?? firstProvider(runtime) ??
      "openai",
  );
  const out = normalizeOut(opts.out ?? template?.default_out ?? "scratch");
  const requestArgs = deepMerge(
    template?.default_request_args_json ?? {},
    opts.request_args_json ?? {},
  );
  const model = opts.model ?? template?.default_model ??
    runtime.providers?.[provider]?.model;
  const register = opts.register ??
    asOptionalString(runtime.globals?.register) ?? '"';
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
  if (
    value === "openai" ||
    value === "claude" ||
    value === "gemini" ||
    value === "codex-cli" ||
    value === "claude-cli"
  ) {
    return value;
  }
  return "openai";
}

function normalizeOut(value: string | undefined): OutputMode {
  if (
    value === "replace" || value === "append" || value === "register" ||
    value === "scratch" || value === "chat"
  ) {
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

function mergeProviderRequestArgs(
  def: ProviderDefinition,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const base = is.Record(def.args)
    ? { ...(def.args as Record<string, unknown>) }
    : {};
  return { ...base, ...(overrides ?? {}) };
}

function resolveCliArgs(def: ProviderDefinition): string[] {
  if (Array.isArray(def.cli_args)) {
    return def.cli_args.map((entry) => String(entry));
  }
  if (
    Array.isArray(def.args) &&
    def.args.every((entry) => typeof entry === "string")
  ) {
    return (def.args as string[]).map((entry) => String(entry));
  }
  return [];
}

function applyProviderContextToArgs(
  provider: CliProvider,
  baseArgs: string[],
  context: ReturnType<typeof getActiveProviderContext>,
): string[] {
  if (!context || context.provider !== provider) {
    return baseArgs.slice();
  }
  const args = baseArgs.slice();
  if (provider === "claude-cli" && context.session_id) {
    args.push("--resume", context.session_id);
  }
  return args;
}

function buildCliPayload(
  options: ApplyOptions,
  requestArgs: Record<string, unknown>,
): CliPayload {
  return {
    system: options.system,
    prompt: options.prompt,
    chat_history: options.chat_history ?? [],
    request: requestArgs,
  };
}

function buildCliEnv(
  def: ProviderDefinition,
): Record<string, string> | undefined {
  if (!def.env) {
    return undefined;
  }
  return { ...def.env };
}

function runtimeDebugEnabled(runtime: RuntimeConfig): boolean {
  return runtime.globals?.debug === true;
}

function resolveCliTimeout(
  def: ProviderDefinition,
  globalTimeout?: number,
): number | undefined {
  if (
    typeof def.timeout_ms === "number" && Number.isFinite(def.timeout_ms) &&
    def.timeout_ms > 0
  ) {
    return def.timeout_ms;
  }
  return globalTimeout;
}

function defaultCliCommand(provider: CliProvider): string {
  return provider === "codex-cli" ? "codex" : "claude";
}

function cliStopSignal(provider: CliProvider): Deno.Signal {
  return provider === "codex-cli" ? "SIGINT" : "SIGTERM";
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
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

async function ensureRuntimeConfigAvailable(
  denops: Denops,
): Promise<RuntimeConfig> {
  const payload = await denops.call("aitrans#config#collect") as unknown;
  const runtime = ensureConfig(payload);
  const current = store.getState().config.runtime;
  if (!current || current.timestamp !== runtime.timestamp) {
    dispatch(configActions.setRuntimeConfig(runtime));
  }
  return runtime;
}

function buildCompletionTarget(
  out: OutputMode,
  ctx: TemplateContext,
  plan: ExecutionPlan,
  chatSessionId?: string | null,
): TemplateCompletionTarget {
  switch (out) {
    case "replace":
      return {
        type: "replace",
        bufnr: ctx.bufnr,
        range: { start: ctx.start_pos, end: ctx.end_pos },
      };
    case "append":
      return {
        type: "append",
        bufnr: ctx.bufnr,
        position: ctx.end_pos,
      };
    case "register":
      return {
        type: "register",
        register: plan.register,
      };
    case "scratch":
      return { type: "scratch" };
    case "chat":
      return { type: "chat", session_id: chatSessionId };
    default:
      return { type: "unknown" };
  }
}

async function showWarning(denops: Denops, message: string): Promise<void> {
  const escaped = message.replace(/'/g, "''");
  await denops.cmd(
    `echohl WarningMsg | echomsg '[aitrans] ${escaped}' | echohl None`,
  );
}

async function focusUsableWindow(
  denops: Denops,
  preferred?: number,
): Promise<boolean> {
  const target = await resolveUsableWindowId(denops, preferred);
  if (target == null) {
    return false;
  }
  await denops.call("nvim_set_current_win", target);
  return true;
}

async function resolveUsableWindowId(
  denops: Denops,
  preferred?: number,
): Promise<number | null> {
  if (await isUsableWindow(denops, preferred)) {
    return preferred as number;
  }
  const current = await denops.call("nvim_get_current_win") as number;
  if (await isUsableWindow(denops, current)) {
    return current;
  }
  const wins = await denops.call("nvim_list_wins") as number[];
  for (const id of wins) {
    if (await isUsableWindow(denops, id)) {
      return id;
    }
  }
  return null;
}

async function isUsableWindow(
  denops: Denops,
  winid?: number,
): Promise<boolean> {
  if (!winid) {
    return false;
  }
  let valid = false;
  try {
    valid = await denops.call("nvim_win_is_valid", winid) as boolean;
  } catch {
    return false;
  }
  if (!valid) {
    return false;
  }
  try {
    const config = await denops.call(
      "nvim_win_get_config",
      winid,
    ) as Record<string, unknown>;
    const relative = typeof config.relative === "string" ? config.relative : "";
    return relative.length === 0;
  } catch {
    return false;
  }
}
