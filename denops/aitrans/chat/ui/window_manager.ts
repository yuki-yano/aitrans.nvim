import type { Denops } from "../../deps/denops.ts";
import { fn } from "../../deps/denops.ts";
import { isUsableWindow, winExists } from "../../utils/window.ts";
import type { ChatSessionState } from "../../store/chat.ts";

export type WindowLayout = {
  layout: "tab" | "split";
  tabnr: number;
  promptWinid: number;
  responseWinid: number;
  originWinid?: number;
};

export type WindowOpenOptions = {
  split?: "vertical" | "tab";
  split_ratio?: number;
  source_bufnr?: number;
};

export async function openChatWindows(
  denops: Denops,
  opts: WindowOpenOptions,
): Promise<WindowLayout> {
  const layout = resolveSplitKind(opts.split);
  const ratio = clampSplitRatio(opts.split_ratio);
  if (layout === "tab") {
    await denops.cmd("tabnew");
    const tabnr = await fn.tabpagenr(denops) as number;
    const originWinid = await fn.win_getid(denops) as number;
    const { responseWinid, promptWinid } = await openSplitWindows(
      denops,
      ratio,
      originWinid,
    );
    return {
      layout,
      tabnr,
      promptWinid,
      responseWinid,
      originWinid,
    };
  }
  const tabnr = await fn.tabpagenr(denops) as number;
  const originWinid = await resolveChatOriginWindow(denops, opts);
  const { responseWinid, promptWinid } = await openSplitWindows(
    denops,
    ratio,
    originWinid,
  );
  return {
    layout,
    tabnr,
    promptWinid,
    responseWinid,
    originWinid,
  };
}

export async function closeChatWindows(
  denops: Denops,
  session: Pick<
    ChatSessionState,
    "layout_mode" | "prompt" | "response" | "origin_winid"
  >,
): Promise<void> {
  if (session.layout_mode === "tab") {
    const tabnr = session.prompt.tabnr;
    const tabCount = await fn.tabpagenr(denops, "$") as number;
    if (tabnr >= 1 && tabnr <= tabCount) {
      await denops.cmd(`tabnext ${tabnr}`);
      await denops.cmd("tabclose");
    }
    return;
  }
  await closeWindowIfValid(denops, session.prompt.winid);
  await closeWindowIfValid(denops, session.response.winid);
  if (
    session.origin_winid &&
    await winExists(denops, session.origin_winid)
  ) {
    await fn.win_gotoid(denops, session.origin_winid);
  }
}

export async function scrollResponseToEnd(
  denops: Denops,
  session: Pick<ChatSessionState, "response">,
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

export function clampSplitRatio(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(0.95, Math.max(0.05, value));
  }
  return 0.66;
}

function resolveSplitKind(input?: "vertical" | "tab"): "tab" | "split" {
  return input === "tab" ? "tab" : "split";
}

async function resolveChatOriginWindow(
  denops: Denops,
  opts: WindowOpenOptions,
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
    if (!await isUsableWindow(denops, winid)) {
      continue;
    }
    const winBufnr = await denops.call("winbufnr", winid) as number;
    if (winBufnr === bufnr) {
      return winid;
    }
  }
  return null;
}

async function openSplitWindows(
  denops: Denops,
  ratio: number,
  originWinid?: number,
): Promise<{ responseWinid: number; promptWinid: number }> {
  const baseWinid = await resolveOriginWindow(denops, originWinid);
  await fn.win_gotoid(denops, baseWinid);
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
    if (!before.has(winid) && await isUsableWindow(denops, winid)) {
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

async function closeWindowIfValid(
  denops: Denops,
  winid: number,
): Promise<void> {
  if (!await winExists(denops, winid)) {
    return;
  }
  try {
    await fn.win_gotoid(denops, winid);
    await denops.cmd("close");
  } catch (_err) {
    // window may already be closed; ignore
  }
}
