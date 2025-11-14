import { buffer, Denops, fn } from "../../deps/denops.ts";
import type { ChatSessionState } from "../../store/chat.ts";
import { store } from "../../store/index.ts";
import type { ChatOpenOptions } from "../types.ts";
import { isChatOpenPayload } from "../types.ts";
import {
  buildResponseBufferLines,
  configurePromptBuffer,
  configureResponseBuffer,
  initializePromptBuffer,
  installPromptKeymaps,
  installResponseKeymaps,
} from "./buffer_manager.ts";
import { clampSplitRatio, openChatWindows } from "./window_manager.ts";

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

export function ensureChatOpenOptions(payload: unknown): ChatOpenOptions {
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

export async function createChatSession(
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

function getRuntimeConfig() {
  return store.getState().config.runtime;
}

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
