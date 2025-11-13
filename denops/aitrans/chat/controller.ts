import { buffer, Denops, fn } from "../deps/denops.ts";
import { is } from "../deps/unknownutil.ts";
import {
  type ChatLogRecord,
  type ChatLogSummary,
  listChatLogs as listChatLogSummaries,
  loadChatLog as loadChatLogRecord,
  saveChatLog as saveChatLogRecord,
} from "./log.ts";
import {
  buildResponseBufferLines,
  configurePromptBuffer,
  configureResponseBuffer,
  initializePromptBuffer,
  installPromptKeymaps,
  installResponseKeymaps,
  resolveSelectionLines,
} from "./ui/buffer_manager.ts";
import {
  clampSplitRatio,
  closeChatWindows,
  openChatWindows,
} from "./ui/window_manager.ts";
import {
  assertActiveSession,
  getActiveSession,
  setFollowUps as setSessionFollowUps,
} from "./session.ts";
import { chatActions, type ChatSessionState } from "../store/chat.ts";
import { dispatch, store } from "../store/index.ts";
import { type ChatOpenOptions, isChatOpenPayload } from "./types.ts";
import {
  archiveChatSession as archiveSessionRecord,
  listChatHistory as listChatHistoryImpl,
  resumeChat as resumeChatImpl,
} from "./archive.ts";

export {
  appendAssistantMessageToChat,
  appendUserMessageToChat,
} from "./messages.ts";

export { createChatOutputSession } from "./ui/buffer_manager.ts";
export type { ChatOutputSession } from "./ui/buffer_manager.ts";

type FollowUpItem = ChatSessionState["followups"][number];

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
  const current = getActiveSession();
  if (current == null) {
    return;
  }
  dispatch(chatActions.setStreaming(false));
  archiveSessionRecord(current);
  dispatch(chatActions.endSession());
  await closeChatWindows(denops, current);
}

export async function submitChat(
  denops: Denops,
): Promise<string | null> {
  const current = getActiveSession();
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
  const current = getActiveSession();
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

export function setFollowUps(
  _denops: Denops,
  payload: unknown,
): void {
  setSessionFollowUps(payload);
}

export async function listChatLogs(
  denops: Denops,
): Promise<ChatLogSummary[]> {
  return await listChatLogSummaries(denops);
}

export async function saveChatLog(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const session = assertActiveSession();
  await saveChatLogRecord(denops, session, payload);
}

export async function loadChatLog(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const record: ChatLogRecord = await loadChatLogRecord(denops, payload);
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
  const runtimeSplit = runtime?.chat?.split === "tab" ? "tab" : "vertical";
  const configuredRatio = clampSplitRatio(runtimeSplitRatio);
  if (!isChatOpenPayload(payload)) {
    return { split_ratio: configuredRatio, split: runtimeSplit };
  }
  const split = payload.split ?? runtimeSplit;
  const ratio = clampSplitRatio(
    payload.split_ratio ?? runtimeSplitRatio ?? configuredRatio,
  );
  return { ...payload, split, split_ratio: ratio };
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
  const windows = await openChatWindows(denops, {
    split: opts.split,
    split_ratio: opts.split_ratio,
    source_bufnr: opts.source_bufnr,
  });
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
  await denops.call("nvim_win_set_buf", windows.responseWinid, responseBufnr);
  await denops.call("nvim_win_set_buf", windows.promptWinid, promptBufnr);
  return await initializeChatBuffers(denops, {
    tabnr: windows.tabnr,
    promptWinid: windows.promptWinid,
    promptBufnr,
    responseWinid: windows.responseWinid,
    responseBufnr,
    opts,
    layout_mode: windows.layout,
    originWinid: windows.originWinid,
  });
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
  await installPromptKeymaps(denops, followUpEnabled);
  await installResponseKeymaps(denops);

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

function getRuntimeConfig() {
  return store.getState().config.runtime;
}

export const listChatHistory = listChatHistoryImpl;

export async function resumeChat(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  await resumeChatImpl(denops, payload, {
    closeChat,
    createChatSession,
  });
}
