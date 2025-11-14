import { autocmd, buffer, Denops, fn, mapping } from "../../deps/denops.ts";
import { createStreamingBuffer } from "../../core/stream_buffer.ts";
import { bufferExists } from "../../utils/buffer.ts";
import { scrollResponseToEnd } from "./window_manager.ts";
import type { ChatOpenOptions } from "../types.ts";
import type { ChatSessionState } from "../../store/chat.ts";
import { chatActions } from "../../store/chat.ts";
import { dispatch } from "../../store/index.ts";
import { assertActiveSession } from "../session.ts";

export type ChatOutputSession = {
  mode: "chat";
  append(text: string): Promise<void>;
  finalize(): Promise<void>;
  fail(reason: unknown): Promise<void>;
};

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

export async function configurePromptBuffer(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "hide");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", "aitrans-prompt.markdown");
  await fn.setbufvar(denops, bufnr, "&modifiable", 1);
}

export async function configureResponseBuffer(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "wipe");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", "aitrans-response.markdown");
  await fn.setbufvar(denops, bufnr, "&wrap", 1);
}

export async function initializePromptBuffer(
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

export async function installPromptKeymaps(
  denops: Denops,
  followUpEnabled: boolean,
): Promise<void> {
  await mapping.map(
    denops,
    "q",
    `<Cmd>call aitrans#chat#close()<CR>`,
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
    `<Cmd>call aitrans#chat#submit()<CR>`,
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
        `<Cmd>call aitrans#chat#apply_followup(${key})<CR>`,
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
    `call aitrans#chat#close()`,
  );
}

export async function installResponseKeymaps(
  denops: Denops,
): Promise<void> {
  await mapping.map(
    denops,
    "q",
    `<Cmd>call aitrans#chat#close()<CR>`,
    {
      buffer: true,
      noremap: true,
      silent: true,
      mode: ["n"],
    },
  );
}

export function buildPromptHeader(opts: ChatOpenOptions): string[] {
  const header = ["# Aitrans Prompt"];
  header.push(`- Template: ${opts.template ?? "n/a"}`);
  header.push(`- Provider: ${opts.provider ?? "auto"}`);
  header.push(`- Output: ${opts.out ?? "chat"}`);
  header.push("---");
  header.push("");
  return header;
}

export function buildResponseBufferLines(initial?: string[]): string[] {
  const base = initial && initial.length > 0
    ? initial
    : ["# Aitrans Response", ""];
  return [...base];
}

export async function resolveSelectionLines(
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

export async function capturePromptInput(
  denops: Denops,
  session: ChatSessionState,
): Promise<string | null> {
  const { prompt, headerLines } = session;
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

export async function applyFollowUpText(
  denops: Denops,
  session: ChatSessionState,
  text: string,
): Promise<void> {
  await buffer.modifiable(denops, session.prompt.bufnr, async () => {
    await fn.setbufline(
      denops,
      session.prompt.bufnr,
      session.headerLines + 1,
      text.split("\n"),
    );
  });
  await fn.win_gotoid(denops, session.prompt.winid);
  await fn.win_execute(
    denops,
    session.prompt.winid,
    `normal! ${session.headerLines + 1}G0`,
  );
}

export async function appendLinesToResponse(
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
    if (lineCount <= 0) {
      await denops.call(
        "nvim_buf_set_lines",
        session.response.bufnr,
        0,
        -1,
        true,
        ["# Aitrans Response", ""],
      );
      lineCount = 2;
    }
    const previous = await denops.call(
      "nvim_buf_get_lines",
      session.response.bufnr,
      Math.max(0, lineCount - 1),
      lineCount,
      true,
    ) as string[];
    if (previous.length > 0 && (previous[0] ?? "").length > 0) {
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

export async function createChatOutputSession(
  denops: Denops,
): Promise<ChatOutputSession> {
  const session = assertActiveSession();
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

export async function updateAssistantEntry(
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

function formatReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return JSON.stringify(reason);
}
