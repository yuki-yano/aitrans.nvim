import { autocmd, buffer, Denops, fn, mapping } from "../deps/denops.ts";
import { join } from "../deps/std_path.ts";
import { as, is, type Predicate } from "../deps/unknownutil.ts";
import { sanitizeLogName } from "./log.ts";
import { createStreamingBuffer } from "../core/stream_buffer.ts";
import { normalizeFollowUps } from "./followup.ts";
import {
  type ArchivedChat,
  chatActions,
  type ChatSessionState,
  type ProviderContext,
} from "../store/chat.ts";
import { dispatch, store } from "../store/index.ts";

type SplitMode = "vertical" | "horizontal";
type SplitInput = SplitMode | "tab" | "float";
type SplitKind = "vertical" | "horizontal" | "tab";
type RangeTuple = [number, number];

type ChatOpenOptions = {
  template?: string;
  provider?: string;
  out?: string;
  follow_up?: boolean;
  selection?: string;
  selection_lines?: string[];
  initial_response_lines?: string[];
  split?: SplitInput;
  range?: RangeTuple;
  source_bufnr?: number;
  split_ratio?: number;
  provider_context?: ProviderContext;
};

type BufferWindow = ChatSessionState["prompt"];

type FollowUpItem = ChatSessionState["followups"][number];

const isSplitInput: Predicate<SplitInput> = (
  value: unknown,
): value is SplitInput =>
  value === "vertical" || value === "horizontal" || value === "tab" ||
  value === "float";
const isRangeTuple = is.TupleOf([is.Number, is.Number]) satisfies Predicate<
  RangeTuple
>;
const isChatOpenPayload = is.ObjectOf({
  template: as.Optional(is.String),
  provider: as.Optional(is.String),
  out: as.Optional(is.String),
  follow_up: as.Optional(is.Boolean),
  selection: as.Optional(is.String),
  selection_lines: as.Optional(is.ArrayOf(is.String)),
  initial_response_lines: as.Optional(is.ArrayOf(is.String)),
  split: as.Optional(isSplitInput),
  range: as.Optional(isRangeTuple),
  source_bufnr: as.Optional(is.Number),
  split_ratio: as.Optional(is.Number),
  provider_context: as.Optional(
    is.ObjectOf({
      provider: is.String,
      thread_id: as.Optional(is.String),
      session_id: as.Optional(is.String),
    }),
  ),
}) satisfies Predicate<ChatOpenOptions>;

export async function openChat(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const opts = ensureChatOpenOptions(payload);
  const selectionLines = await resolveSelectionLines(denops, opts);
  await closeChat(denops);
  const session = await createChatSession(denops, {
    ...opts,
    selection_lines: selectionLines ?? opts.selection_lines,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setStreaming(false));
}

export async function closeChat(denops: Denops): Promise<void> {
  const current = getSession();
  if (current == null) {
    return;
  }
  dispatch(chatActions.setStreaming(false));
  archiveChatSession(current);
  dispatch(chatActions.endSession());
  if (current.layout_mode === "tab") {
    const tabnr = current.prompt.tabnr;
    const tabCount = await fn.tabpagenr(denops, "$") as number;
    if (tabnr >= 1 && tabnr <= tabCount) {
      await denops.cmd(`tabnext ${tabnr}`);
      await denops.cmd("tabclose");
    }
    return;
  }
  await closeWindowIfValid(denops, current.prompt.winid);
  await closeWindowIfValid(denops, current.response.winid);
  if (current.origin_winid && await winExists(denops, current.origin_winid)) {
    await fn.win_gotoid(denops, current.origin_winid);
  }
}

export async function submitChat(
  denops: Denops,
): Promise<string | null> {
  const current = getSession();
  if (current == null) {
    return null;
  }
  const { prompt, headerLines } = current;
  await fn.win_gotoid(denops, prompt.winid);
  const lines = await fn.getbufline(
    denops,
    prompt.bufnr,
    headerLines + 1,
    "$",
  ) as string[];
  const text = lines.join("\n").trim();
  if (text.length === 0) {
    return null;
  }
  await buffer.modifiable(denops, prompt.bufnr, async () => {
    await fn.deletebufline(denops, prompt.bufnr, headerLines + 1, "$");
    await fn.appendbufline(denops, prompt.bufnr, headerLines, [""]);
  });
  await fn.win_gotoid(denops, prompt.winid);
  await fn.win_execute(denops, prompt.winid, `normal! ${headerLines + 1}G0`);
  return text;
}

export async function applyFollowUp(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const current = getSession();
  if (current == null) {
    return;
  }
  const index = ensureFollowUpIndex(payload);
  if (index == null) {
    return;
  }
  const item = current.followups.find((entry) => entry.key === index);
  if (!item) {
    return;
  }
  await buffer.modifiable(denops, current.prompt.bufnr, async () => {
    await fn.setbufline(
      denops,
      current.prompt.bufnr,
      current.headerLines + 1,
      item.text.split("\n"),
    );
  });
  await fn.win_gotoid(denops, current.prompt.winid);
  await fn.win_execute(
    denops,
    current.prompt.winid,
    `normal! ${current.headerLines + 1}G0`,
  );
}

export async function appendUserMessageToChat(
  denops: Denops,
  session: ChatSessionState,
  text: string,
  record = true,
): Promise<void> {
  const lines = ["## You", ...text.split("\n")];
  await appendLinesToResponse(denops, session, lines);
  if (record) {
    dispatch(chatActions.pushMessage({ role: "user", content: text }));
  }
  await scrollResponseToEnd(denops, session);
}

export async function appendAssistantMessageToChat(
  denops: Denops,
  session: ChatSessionState,
  text: string,
  record = true,
): Promise<void> {
  const lines = ["## Assistant", ...text.split("\n")];
  await appendLinesToResponse(denops, session, lines);
  if (record) {
    dispatch(chatActions.pushMessage({ role: "assistant", content: text }));
  }
  await scrollResponseToEnd(denops, session);
}

export function setFollowUps(
  _denops: Denops,
  payload: unknown,
): void {
  const items = normalizeFollowUps(payload) as FollowUpItem[];
  dispatch(chatActions.setFollowups(items));
}

type ChatLogRecord = {
  id: string;
  template?: string;
  provider?: string;
  follow_up_enabled: boolean;
  followups: FollowUpItem[];
  prompt_text: string;
  response_text: string;
  created_at: string;
  provider_context?: ProviderContext;
};

type ChatLogSummary = {
  name: string;
  path: string;
  created_at: string;
  template?: string;
  provider?: string;
};

export async function listChatLogs(denops: Denops): Promise<ChatLogSummary[]> {
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
  payload: unknown,
): Promise<void> {
  const session = getSession();
  if (session == null) {
    throw new Error("aitrans: chat session is not active");
  }
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
): Promise<void> {
  const target = await resolveLogPath(denops, payload);
  const record = JSON.parse(await Deno.readTextFile(target)) as ChatLogRecord;
  await closeChat(denops);
  const session = await createChatSession(denops, {
    template: record.template,
    provider: record.provider,
    follow_up: record.follow_up_enabled,
    selection_lines: record.prompt_text.split("\n"),
    initial_response_lines: record.response_text.split("\n"),
    provider_context: record.provider_context,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setFollowups(record.followups ?? []));
}

function ensureChatOpenOptions(payload: unknown): ChatOpenOptions {
  const runtime = getRuntimeConfig();
  const runtimeSplitRatio = typeof runtime?.chat?.split_ratio === "number"
    ? runtime.chat.split_ratio
    : undefined;
  const configuredRatio = clampSplitRatio(runtimeSplitRatio);
  if (!isChatOpenPayload(payload)) {
    return { split_ratio: configuredRatio };
  }
  const ratio = clampSplitRatio(
    payload.split_ratio ?? runtimeSplitRatio ?? configuredRatio,
  );
  return { ...payload, split_ratio: ratio };
}

function ensureFollowUpIndex(payload: unknown): number | null {
  if (is.Record(payload) && is.Number(payload.index)) {
    return Math.trunc(payload.index);
  }
  if (typeof payload === "number") {
    return Math.trunc(payload);
  }
  return null;
}

async function createChatSession(
  denops: Denops,
  opts: ChatOpenOptions,
): Promise<ChatSessionState> {
  const splitKind = resolveSplitKind(opts.split);
  if (splitKind === "tab") {
    return await createTabChatSession(denops, opts);
  }
  const originWinid = await resolveChatOriginWindow(denops, opts);
  return await createSplitChatSession(denops, splitKind, opts, originWinid);
}

function resolveSplitKind(input?: SplitInput): SplitKind {
  if (input === "horizontal") {
    return "horizontal";
  }
  if (input === "tab") {
    return "tab";
  }
  return "vertical";
}

async function resolveChatOriginWindow(
  denops: Denops,
  opts: ChatOpenOptions,
): Promise<number> {
  const winid = await findWindowDisplayingBuffer(denops, opts.source_bufnr);
  if (winid != null) {
    return winid;
  }
  return await fn.win_getid(denops) as number;
}

async function findWindowDisplayingBuffer(
  denops: Denops,
  bufnr?: number,
): Promise<number | null> {
  if (typeof bufnr !== "number" || bufnr <= 0) {
    return null;
  }
  const wins = await denops.call("nvim_list_wins") as number[];
  for (const winid of wins) {
    if (!await winExists(denops, winid)) {
      continue;
    }
    if (!await isNormalWindow(denops, winid)) {
      continue;
    }
    const winBufnr = await denops.call("winbufnr", winid) as number;
    if (winBufnr === bufnr) {
      return winid;
    }
  }
  return null;
}

async function isNormalWindow(
  denops: Denops,
  winid: number,
): Promise<boolean> {
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

async function createTabChatSession(
  denops: Denops,
  opts: ChatOpenOptions,
): Promise<ChatSessionState> {
  await denops.cmd("tabnew");
  const tabnr = await fn.tabpagenr(denops) as number;
  const originWinid = await fn.win_getid(denops) as number;
  const { responseWinid, promptWinid } = await openSplitWindows(
    denops,
    "vertical",
    opts,
    originWinid,
  );
  const responseBufnr = await denops.call(
    "nvim_create_buf",
    false,
    true,
  ) as number;
  const promptBufnr = await denops.call(
    "nvim_create_buf",
    false,
    true,
  ) as number;
  await denops.call("nvim_win_set_buf", responseWinid, responseBufnr);
  await denops.call("nvim_win_set_buf", promptWinid, promptBufnr);
  return await initializeChatBuffers(denops, {
    tabnr,
    promptWinid,
    promptBufnr,
    responseWinid,
    responseBufnr,
    opts,
    layout_mode: "tab",
  });
}

async function createSplitChatSession(
  denops: Denops,
  kind: "vertical" | "horizontal",
  opts: ChatOpenOptions,
  originWinid: number,
): Promise<ChatSessionState> {
  const tabnr = await fn.tabpagenr(denops) as number;
  const { responseWinid, promptWinid } = await openSplitWindows(
    denops,
    kind,
    opts,
    originWinid,
  );
  const responseBufnr = await denops.call(
    "nvim_create_buf",
    false,
    true,
  ) as number;
  const promptBufnr = await denops.call(
    "nvim_create_buf",
    false,
    true,
  ) as number;
  await denops.call("nvim_win_set_buf", responseWinid, responseBufnr);
  await denops.call("nvim_win_set_buf", promptWinid, promptBufnr);
  return await initializeChatBuffers(denops, {
    tabnr,
    promptWinid,
    promptBufnr,
    responseWinid,
    responseBufnr,
    opts,
    layout_mode: "split",
    originWinid,
  });
}

async function openSplitWindows(
  denops: Denops,
  kind: "vertical" | "horizontal",
  opts: ChatOpenOptions,
  originWinid?: number,
): Promise<{ responseWinid: number; promptWinid: number }> {
  const baseWinid = await resolveOriginWindow(denops, originWinid);
  await fn.win_gotoid(denops, baseWinid);
  const ratio = clampSplitRatio(opts.split_ratio);
  if (kind === "vertical") {
    const beforeVsplit = await snapshotWindows(denops);
    await denops.cmd("noautocmd keepalt botright vsplit");
    const responseWinid = await detectNewWindow(denops, beforeVsplit) ??
      await fn.win_getid(denops) as number;
    const columns = await denops.call("eval", "&columns") as number;
    const width = Math.max(40, Math.floor(columns * 0.42));
    await denops.cmd(`noautocmd vertical resize ${width}`);
    await fn.win_gotoid(denops, responseWinid);
    const beforeSplit = await snapshotWindows(denops);
    await denops.cmd("noautocmd keepalt belowright split");
    const promptWinid = await detectNewWindow(denops, beforeSplit) ??
      await fn.win_getid(denops) as number;
    await balanceStackHeights(denops, responseWinid, promptWinid, ratio);
    return { responseWinid, promptWinid };
  }
  const responseWinid = baseWinid;
  const beforeSplit = await snapshotWindows(denops);
  await denops.cmd("noautocmd keepalt botright split");
  const promptWinid = await detectNewWindow(denops, beforeSplit) ??
    await fn.win_getid(denops) as number;
  await balanceStackHeights(denops, responseWinid, promptWinid, ratio);
  return { responseWinid, promptWinid };
}

async function snapshotWindows(denops: Denops): Promise<Set<number>> {
  const wins = await denops.call("nvim_list_wins") as number[];
  return new Set(wins);
}

async function detectNewWindow(
  denops: Denops,
  before: Set<number>,
): Promise<number | null> {
  const wins = await denops.call("nvim_list_wins") as number[];
  for (const winid of wins) {
    if (!before.has(winid) && await isNormalWindow(denops, winid)) {
      return winid;
    }
  }
  return null;
}

async function resolveOriginWindow(
  denops: Denops,
  winid?: number,
): Promise<number> {
  if (winid && await winExists(denops, winid)) {
    return winid;
  }
  return await fn.win_getid(denops) as number;
}

async function balanceStackHeights(
  denops: Denops,
  responseWinid: number,
  promptWinid: number,
  ratio: number,
): Promise<void> {
  const responseHeight = await denops.call(
    "nvim_win_get_height",
    responseWinid,
  ) as number;
  const promptHeight = await denops.call(
    "nvim_win_get_height",
    promptWinid,
  ) as number;
  const totalHeight = Math.max(2, responseHeight + promptHeight);
  const minPrompt = Math.min(5, Math.max(1, totalHeight - 1));
  const minResponse = Math.min(5, Math.max(1, totalHeight - minPrompt));
  const maxResponse = Math.max(minResponse, totalHeight - minPrompt);
  let desiredResponse = Math.floor(totalHeight * ratio);
  desiredResponse = Math.min(
    maxResponse,
    Math.max(minResponse, desiredResponse),
  );
  let desiredPrompt = totalHeight - desiredResponse;
  if (desiredPrompt < minPrompt) {
    desiredPrompt = minPrompt;
    desiredResponse = Math.max(minResponse, totalHeight - desiredPrompt);
  }
  await denops.call("nvim_win_set_height", responseWinid, desiredResponse);
  await denops.call("nvim_win_set_height", promptWinid, desiredPrompt);
}

type InitializeArgs = {
  tabnr: number;
  promptWinid: number;
  promptBufnr: number;
  responseWinid: number;
  responseBufnr: number;
  opts: ChatOpenOptions;
  layout_mode: "tab" | "split";
  originWinid?: number;
};

async function initializeChatBuffers(
  denops: Denops,
  args: InitializeArgs,
): Promise<ChatSessionState> {
  const {
    tabnr,
    promptWinid,
    promptBufnr,
    responseWinid,
    responseBufnr,
    opts,
    layout_mode,
    originWinid,
  } = args;
  await configurePromptBuffer(denops, promptBufnr);
  await configureResponseBuffer(denops, responseBufnr);
  await fn.win_gotoid(denops, promptWinid);

  const headerLines = await initializePromptBuffer(denops, promptBufnr, opts);
  await fn.win_execute(denops, promptWinid, `normal! ${headerLines + 1}G0`);

  const followUpEnabled = opts.follow_up === true;
  await installPromptKeymaps(denops, promptBufnr, followUpEnabled);
  await installResponseKeymaps(denops, responseBufnr);

  await buffer.modifiable(denops, responseBufnr, async () => {
    const responseLines = buildResponseBufferLines(opts.initial_response_lines);
    await fn.deletebufline(denops, responseBufnr, 1, "$");
    await fn.setbufline(denops, responseBufnr, 1, responseLines);
  });

  return {
    id: crypto.randomUUID(),
    prompt: { tabnr, winid: promptWinid, bufnr: promptBufnr },
    response: { tabnr, winid: responseWinid, bufnr: responseBufnr },
    headerLines,
    followups: [],
    followUpEnabled,
    template: opts.template,
    provider: opts.provider,
    layout_mode,
    origin_winid: originWinid,
    messages: [],
    streaming: false,
    providerContext: opts.provider_context ??
      (opts.provider ? { provider: opts.provider } : undefined),
  };
}

async function initializePromptBuffer(
  denops: Denops,
  bufnr: number,
  opts: ChatOpenOptions,
): Promise<number> {
  const header = buildPromptHeader(opts);
  await buffer.modifiable(denops, bufnr, async () => {
    await fn.deletebufline(denops, bufnr, 1, "$");
    await fn.setbufline(denops, bufnr, 1, header);
    await fn.appendbufline(denops, bufnr, header.length, [""]);
  });
  return header.length;
}

async function configurePromptBuffer(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "hide");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", "aitrans-prompt.markdown");
  await fn.setbufvar(denops, bufnr, "&modifiable", 1);
}

async function configureResponseBuffer(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "wipe");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", "aitrans-response.markdown");
  await fn.setbufvar(denops, bufnr, "&wrap", 1);
}

async function installPromptKeymaps(
  denops: Denops,
  _bufnr: number,
  followUpEnabled: boolean,
): Promise<void> {
  await mapping.map(
    denops,
    "q",
    `<Cmd>call denops#notify("${denops.name}", "chatClose", [])<CR>`,
    {
      buffer: true,
      noremap: true,
      silent: true,
      mode: ["n"],
    },
  );
  await mapping.map(
    denops,
    "<CR>",
    `<Cmd>call denops#notify("${denops.name}", "chatSubmit", [])<CR>`,
    {
      buffer: true,
      noremap: true,
      silent: true,
      mode: ["n"],
    },
  );
  if (followUpEnabled) {
    for (const key of [1, 2, 3, 4]) {
      await mapping.map(
        denops,
        String(key),
        `<Cmd>call denops#notify("${denops.name}", "chatApplyFollowUp", [{"index": ${key}}])<CR>`,
        {
          buffer: true,
          noremap: true,
          silent: true,
          mode: ["n"],
        },
      );
    }
  }

  await autocmd.define(
    denops,
    "WinClosed",
    "<buffer>",
    `call denops#notify("${denops.name}", "chatClose", [])`,
  );
}

async function installResponseKeymaps(
  denops: Denops,
  _bufnr: number,
): Promise<void> {
  await mapping.map(
    denops,
    "q",
    `<Cmd>call denops#notify("${denops.name}", "chatClose", [])<CR>`,
    {
      buffer: true,
      noremap: true,
      silent: true,
      mode: ["n"],
    },
  );
}

function buildPromptHeader(opts: ChatOpenOptions): string[] {
  const header = ["# Aitrans Prompt"];
  header.push(`- Template: ${opts.template ?? "n/a"}`);
  header.push(`- Provider: ${opts.provider ?? "auto"}`);
  header.push(`- Output: ${opts.out ?? "chat"}`);
  header.push("---");
  header.push("");
  return header;
}

function buildResponseBufferLines(initial?: string[]): string[] {
  const base = initial && initial.length > 0
    ? initial
    : ["# Aitrans Response", ""];
  return [...base];
}

async function resolveSelectionLines(
  denops: Denops,
  opts: ChatOpenOptions,
): Promise<string[] | undefined> {
  if (opts.selection) {
    return opts.selection.split("\n");
  }
  if (opts.selection_lines && opts.selection_lines.length > 0) {
    return opts.selection_lines;
  }
  if (!opts.range) {
    return undefined;
  }
  const [start, end] = opts.range;
  if (start <= 0 || end < start) {
    return undefined;
  }
  const bufnr = opts.source_bufnr ?? await fn.bufnr(denops, "%") as number;
  const lines = await fn.getbufline(denops, bufnr, start, end) as string[];
  return lines;
}

function getSession(): ChatSessionState | null {
  return store.getState().chat.session;
}

export function getActiveProviderContext(): ProviderContext | null {
  const session = getSession();
  return session?.providerContext ?? null;
}

export function updateChatProviderContext(context: ProviderContext): void {
  dispatch(chatActions.setProviderContext(context));
}

export type ChatOutputSession = {
  mode: "chat";
  append(text: string): Promise<void>;
  finalize(): Promise<void>;
  fail(reason: unknown): Promise<void>;
};

export async function createChatOutputSession(
  denops: Denops,
): Promise<ChatOutputSession> {
  const session = getSession();
  if (session == null) {
    throw new Error("aitrans: chat session is not active");
  }
  const writer = createStreamingBuffer();
  const assistantEntry = await startAssistantEntry(denops, session);
  let spinner: AssistantSpinnerHandle | null = startAssistantSpinner(
    denops,
    session,
    assistantEntry,
  );
  dispatch(chatActions.setStreaming(true));
  return {
    mode: "chat",
    async append(text: string) {
      if (!text) return;
      if (spinner) {
        await spinner.stop();
        spinner = null;
      }
      writer.append(text);
      await updateAssistantEntry(
        denops,
        session,
        assistantEntry,
        writer.getLines(),
      );
    },
    async finalize() {
      if (spinner) {
        await spinner.stop();
        spinner = null;
      }
      await updateAssistantEntry(
        denops,
        session,
        assistantEntry,
        writer.getLines(),
      );
      dispatch(chatActions.pushMessage({
        role: "assistant",
        content: writer.getLines().join("\n"),
      }));
      dispatch(chatActions.setStreaming(false));
    },
    async fail(reason: unknown) {
      if (spinner) {
        await spinner.stop();
        spinner = null;
      }
      if (reason) {
        writer.append(`\n> ${formatReason(reason)}`);
        await updateAssistantEntry(
          denops,
          session,
          assistantEntry,
          writer.getLines(),
        );
      }
      dispatch(chatActions.setStreaming(false));
    },
  };
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
  if (is.Record(payload) && typeof payload.name === "string") {
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
  } else if (is.Record(payload)) {
    if (typeof payload.path === "string") {
      path = payload.path;
    } else if (typeof payload.name === "string") {
      name = payload.name;
    }
  }
  if (path) {
    return path;
  }
  const logDir = await resolveLogDir(denops);
  const base = sanitizeLogName(name ?? "latest");
  return join(logDir, base.endsWith(".json") ? base : `${base}.json`);
}

async function readBufferText(denops: Denops, bufnr: number): Promise<string> {
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

async function winExists(denops: Denops, winid: number): Promise<boolean> {
  if (!winid) {
    return false;
  }
  try {
    return await denops.call("nvim_win_is_valid", winid) as boolean;
  } catch {
    return false;
  }
}

async function bufferExists(denops: Denops, bufnr: number): Promise<boolean> {
  if (!bufnr) {
    return false;
  }
  try {
    return await denops.call("nvim_buf_is_valid", bufnr) as boolean;
  } catch {
    return false;
  }
}

async function closeWindowIfValid(
  denops: Denops,
  winid: number,
): Promise<void> {
  if (await winExists(denops, winid)) {
    try {
      await denops.call("nvim_win_close", winid, true);
    } catch {
      // ignore
    }
  }
}

type AssistantEntryHandle = {
  ns: number;
  markId: number;
  contentLines: number;
};

type AssistantSpinnerHandle = {
  stop(options?: { clear?: boolean }): Promise<void>;
};

const assistantSpinnerFrames = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
const assistantSpinnerIntervalMs = 100;

const assistantNamespaceName = "aitrans-chat-assistant";
let assistantNamespace: number | null = null;

async function appendLinesToResponse(
  denops: Denops,
  session: ChatSessionState,
  lines: string[],
): Promise<void> {
  if (!await bufferExists(denops, session.response.bufnr)) {
    return;
  }
  await buffer.modifiable(denops, session.response.bufnr, async () => {
    let lineCount = await denops.call(
      "nvim_buf_line_count",
      session.response.bufnr,
    ) as number;
    if (lineCount > 0) {
      const prev = await denops.call(
        "nvim_buf_get_lines",
        session.response.bufnr,
        lineCount - 1,
        lineCount,
        true,
      ) as string[];
      if (prev.length === 0 || (prev[0] ?? "").length > 0) {
        await denops.call(
          "nvim_buf_set_lines",
          session.response.bufnr,
          lineCount,
          lineCount,
          true,
          [""],
        );
        lineCount += 1;
      }
    }
    await denops.call(
      "nvim_buf_set_lines",
      session.response.bufnr,
      lineCount,
      lineCount,
      true,
      lines.at(-1) === "" ? lines : [...lines, ""],
    );
  });
}

async function ensureAssistantNamespace(denops: Denops): Promise<number> {
  if (assistantNamespace != null) {
    return assistantNamespace;
  }
  assistantNamespace = await denops.call(
    "nvim_create_namespace",
    assistantNamespaceName,
  ) as number;
  return assistantNamespace;
}

async function startAssistantEntry(
  denops: Denops,
  session: ChatSessionState,
): Promise<AssistantEntryHandle> {
  const ns = await ensureAssistantNamespace(denops);
  const startRow = await denops.call(
    "nvim_buf_line_count",
    session.response.bufnr,
  ) as number;
  await appendLinesToResponse(denops, session, ["## Assistant", ""]);
  const markId = await denops.call(
    "nvim_buf_set_extmark",
    session.response.bufnr,
    ns,
    startRow,
    0,
    { right_gravity: false },
  ) as number;
  return { ns, markId, contentLines: 1 };
}

function startAssistantSpinner(
  denops: Denops,
  session: ChatSessionState,
  entry: AssistantEntryHandle,
): AssistantSpinnerHandle {
  let active = true;
  let frame = 0;
  const loop = async () => {
    while (active) {
      if (!await bufferExists(denops, session.response.bufnr)) {
        active = false;
        break;
      }
      const glyph =
        assistantSpinnerFrames[frame % assistantSpinnerFrames.length];
      frame = (frame + 1) % assistantSpinnerFrames.length;
      try {
        await updateAssistantEntry(denops, session, entry, [
          `${glyph} Loading...`,
        ]);
      } catch (_err) {
        // ignore update failures (window may be closing)
      }
      await sleep(assistantSpinnerIntervalMs);
    }
  };
  const pending = loop();
  return {
    async stop(options?: { clear?: boolean }) {
      if (!active) {
        return;
      }
      active = false;
      await pending.catch(() => {});
      if (options?.clear !== false) {
        try {
          await updateAssistantEntry(denops, session, entry, [""]);
        } catch (_err) {
          // ignore
        }
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateAssistantEntry(
  denops: Denops,
  session: ChatSessionState,
  entry: AssistantEntryHandle,
  lines: string[],
): Promise<void> {
  if (!await bufferExists(denops, session.response.bufnr)) {
    return;
  }
  const pos = await denops.call(
    "nvim_buf_get_extmark_by_id",
    session.response.bufnr,
    entry.ns,
    entry.markId,
    {},
  ) as [number, number] | [];
  if (!Array.isArray(pos) || pos.length < 2) {
    return;
  }
  const headerRow = pos[0]!;
  const contentRow = headerRow + 1;
  const content = lines.length > 0 ? lines : [""];
  await buffer.modifiable(denops, session.response.bufnr, async () => {
    await denops.call(
      "nvim_buf_set_lines",
      session.response.bufnr,
      contentRow,
      contentRow + entry.contentLines,
      true,
      content,
    );
  });
  entry.contentLines = content.length;
  await scrollResponseToEnd(denops, session);
}

async function scrollResponseToEnd(
  denops: Denops,
  session: ChatSessionState,
): Promise<void> {
  if (!(await winExists(denops, session.response.winid))) {
    return;
  }
  const lineCount = await denops.call(
    "nvim_buf_line_count",
    session.response.bufnr,
  ) as number;
  if (lineCount <= 0) {
    return;
  }
  const row = Math.max(1, lineCount);
  try {
    await denops.call(
      "nvim_win_set_cursor",
      session.response.winid,
      [row, 0],
    );
  } catch (_err) {
    // Ignore cases where the response window no longer exists or shrank.
  }
}

function archiveChatSession(session: ChatSessionState): void {
  if (session.messages.length === 0) {
    return;
  }
  const entry: ArchivedChat = {
    id: session.id,
    template: session.template,
    provider: session.provider,
    followUpEnabled: session.followUpEnabled,
    createdAt: new Date().toISOString(),
    messages: [...session.messages],
    providerContext: session.providerContext,
  };
  dispatch(chatActions.archiveSession(entry));
}

export function listChatHistory(): ArchivedChat[] {
  return store.getState().chat.history;
}

const isResumePayload = is.ObjectOf({
  id: as.Optional(is.String),
});

function resolveResumeId(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }
  if (isResumePayload(payload) && typeof payload.id === "string") {
    const trimmed = payload.id.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

export async function resumeChat(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const history = listChatHistory();
  if (history.length === 0) {
    throw new Error("aitrans: no chat history to resume");
  }
  const resumeId = resolveResumeId(payload);
  const target = resumeId
    ? history.find((entry) => entry.id === resumeId)
    : history[0];
  if (!target) {
    throw new Error(`aitrans: chat history "${resumeId}" was not found`);
  }
  await closeChat(denops);
  const session = await createChatSession(denops, {
    template: target.template,
    provider: target.provider,
    follow_up: target.followUpEnabled,
    provider_context: target.providerContext,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setMessages([...target.messages]));
  const active = getSession();
  if (!active) {
    return;
  }
  await buffer.modifiable(denops, active.response.bufnr, async () => {
    await fn.deletebufline(denops, active.response.bufnr, 1, "$");
    await fn.setbufline(
      denops,
      active.response.bufnr,
      1,
      ["# Aitrans Response", ""],
    );
  });
  await buffer.modifiable(denops, active.prompt.bufnr, async () => {
    await fn.deletebufline(
      denops,
      active.prompt.bufnr,
      active.headerLines + 1,
      "$",
    );
    await fn.appendbufline(
      denops,
      active.prompt.bufnr,
      active.headerLines,
      ["", ""],
    );
  });
  for (const message of target.messages) {
    if (message.role === "user") {
      await appendUserMessageToChat(denops, active, message.content, false);
    } else {
      await appendAssistantMessageToChat(
        denops,
        active,
        message.content,
        false,
      );
    }
  }
}

function clampSplitRatio(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(0.95, Math.max(0.05, value));
  }
  return 0.66;
}

function formatReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return JSON.stringify(reason);
}
