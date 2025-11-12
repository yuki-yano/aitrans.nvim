import { buffer, Denops, fn } from "../deps/denops.ts";
import type { TemplateContext } from "./context.ts";
import type { OutputMode } from "./apply_options.ts";
import { createStreamingBuffer } from "./stream_buffer.ts";

export type ScratchSplit = "horizontal" | "vertical" | "tab" | "float";

export type OutputSession = {
  mode: Exclude<OutputMode, "chat">;
  append(text: string): Promise<void>;
  finalize(): Promise<void>;
  fail(reason: unknown): Promise<void>;
};

export type CreateOutputSessionOptions = {
  mode: Exclude<OutputMode, "chat">;
  ctx: TemplateContext;
  register?: string;
  scratchSplit?: ScratchSplit;
};

const namespaceName = "aitrans-output";
let outputNamespace: number | null = null;

export async function createOutputSession(
  denops: Denops,
  options: CreateOutputSessionOptions,
): Promise<OutputSession> {
  switch (options.mode) {
    case "replace":
      return await createReplaceSession(denops, options.ctx);
    case "append":
      return await createAppendSession(denops, options.ctx);
    case "register":
      return createRegisterSession(denops, options.register);
    case "scratch":
    default:
      return await createScratchSession(denops, options.scratchSplit);
  }
}

async function createReplaceSession(
  denops: Denops,
  ctx: TemplateContext,
): Promise<OutputSession> {
  const writer = createStreamingBuffer();
  const startRow = ctx.start_pos.row - 1;
  const startCol = Math.max(0, ctx.start_pos.col - 1);
  const endRow = ctx.end_pos.row - 1;
  const endCol = Math.max(0, ctx.end_pos.col);
  return {
    mode: "replace",
    async append(text) {
      if (!text) return;
      writer.append(text);
    },
    async finalize() {
      const lines = splitText(writer.getLines().join("\n"));
      await denops.call(
        "nvim_buf_set_text",
        ctx.bufnr,
        startRow,
        startCol,
        endRow,
        endCol,
        lines,
      );
    },
    async fail() {
      // no-op
    },
  };
}

async function createAppendSession(
  denops: Denops,
  ctx: TemplateContext,
): Promise<OutputSession> {
  const writer = createStreamingBuffer();
  const ns = await ensureNamespace(denops);
  const lineCount = await fn.line(denops, "$") as number;
  const insertIndex = Math.min(
    Math.max(0, ctx.end_pos.row),
    Math.max(0, lineCount),
  );
  await denops.call(
    "nvim_buf_set_lines",
    ctx.bufnr,
    insertIndex,
    insertIndex,
    true,
    [""],
  );
  const markId = await denops.call(
    "nvim_buf_set_extmark",
    ctx.bufnr,
    ns,
    insertIndex,
    0,
    { right_gravity: true },
  ) as number;
  let hasAppended = false;

  return {
    mode: "append",
    async append(text) {
      if (!text) return;
      writer.append(text);
      const pos = await denops.call(
        "nvim_buf_get_extmark_by_id",
        ctx.bufnr,
        ns,
        markId,
        {},
      ) as [number, number] | [];
      if (!Array.isArray(pos) || pos.length < 2) {
        return;
      }
      const [row, col] = pos;
      const chunk = writer.drainText();
      if (chunk.length === 0) {
        return;
      }
      const chunkLines = splitText(chunk);
      hasAppended = true;
      await denops.call(
        "nvim_buf_set_text",
        ctx.bufnr,
        row,
        col,
        row,
        col,
        chunkLines,
      );
    },
    async finalize() {
      if (!hasAppended) {
        await denops.call(
          "nvim_buf_set_lines",
          ctx.bufnr,
          insertIndex,
          insertIndex + 1,
          true,
          [],
        );
      }
    },
    async fail(reason) {
      if (!reason) return;
      const pos = await denops.call(
        "nvim_buf_get_extmark_by_id",
        ctx.bufnr,
        ns,
        markId,
        {},
      ) as [number, number] | [];
      if (!Array.isArray(pos) || pos.length < 2) {
        return;
      }
      const message = formatReason(reason);
      await denops.call(
        "nvim_buf_set_text",
        ctx.bufnr,
        pos[0],
        pos[1],
        pos[0],
        pos[1],
        splitText(`\n> ${message}`),
      );
    },
  };
}

function createRegisterSession(denops: Denops, register?: string): OutputSession {
  const writer = createStreamingBuffer();
  const target = register && register.length > 0 ? register : '"';
  return {
    mode: "register",
    async append(text) {
      if (!text) return;
      writer.append(text);
    },
    async finalize() {
      const text = writer.getLines().join("\n");
      await denops.call("setreg", target, text);
    },
    async fail() {
      // no-op
    },
  };
}

async function createScratchSession(
  denops: Denops,
  splitMode?: ScratchSplit,
): Promise<OutputSession> {
  const split = splitMode ?? "horizontal";
  const { bufnr, winid } = await openScratchWindow(denops, split);
  const headerLines = await configureScratchBuffer(denops, bufnr);
  const writer = createStreamingBuffer();

  async function rewrite(lines: string[]): Promise<void> {
    await buffer.modifiable(denops, bufnr, async () => {
      const body = lines.length > 0 ? [...lines] : [""];
      await denops.call(
        "nvim_buf_set_lines",
        bufnr,
        headerLines,
        -1,
        true,
        body,
      );
    });
  }

  return {
    mode: "scratch",
    async append(text) {
      if (!text) return;
      writer.append(text);
      await rewrite(writer.getLines());
    },
    async finalize() {
      await rewrite(writer.getLines());
    },
    async fail(reason) {
      if (!reason) {
        return;
      }
      writer.append(`\n[aitrans] ${formatReason(reason)}`);
      await rewrite(writer.getLines());
    },
  };
}

async function openScratchWindow(
  denops: Denops,
  split: ScratchSplit,
): Promise<{ bufnr: number; winid: number }> {
  if (split === "vertical") {
    await denops.cmd("botright vsplit");
    await denops.cmd("enew");
    const bufnr = await fn.bufnr(denops, "%") as number;
    const winid = await fn.win_getid(denops) as number;
    return { bufnr, winid };
  }
  if (split === "tab") {
    await denops.cmd("tabnew");
    await denops.cmd("enew");
    const bufnr = await fn.bufnr(denops, "%") as number;
    const winid = await fn.win_getid(denops) as number;
    return { bufnr, winid };
  }
  if (split === "float") {
    const bufnr = await denops.call("nvim_create_buf", true, true) as number;
    const width = Math.max(40, Math.floor(((await fn.winwidth(denops, 0) as number) || 120) * 0.6));
    const height = Math.max(10, Math.floor(((await fn.winheight(denops, 0) as number) || 40) * 0.6));
    const winid = await denops.call("nvim_open_win", bufnr, true, {
      relative: "editor",
      row: 2,
      col: 4,
      width,
      height,
      border: "single",
    }) as number;
    return { bufnr, winid };
  }
  await denops.cmd("botright split");
  await denops.cmd("enew");
  const bufnr = await fn.bufnr(denops, "%") as number;
  const winid = await fn.win_getid(denops) as number;
  return { bufnr, winid };
}

async function configureScratchBuffer(denops: Denops, bufnr: number): Promise<number> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "wipe");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", "aitrans-scratch.markdown");
  await fn.setbufvar(denops, bufnr, "&modifiable", 1);
  await fn.setbufvar(denops, bufnr, "&readonly", 0);
  const header = ["# Aitrans Scratch", ""];
  await fn.setbufline(denops, bufnr, 1, header);
  await denops.call(
    "nvim_buf_set_keymap",
    bufnr,
    "n",
    "q",
    "<Cmd>close<CR>",
    { noremap: true, silent: true },
  );
  return header.length;
}

function splitText(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
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

async function ensureNamespace(denops: Denops): Promise<number> {
  if (outputNamespace !== null) {
    return outputNamespace;
  }
  outputNamespace = await denops.call("nvim_create_namespace", namespaceName) as number;
  return outputNamespace;
}
