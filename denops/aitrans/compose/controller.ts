import { autocmd, buffer, Denops, fn, mapping } from "../deps/denops.ts";

export type ComposeEditorConfig = {
  ui: "float" | "vsplit" | "tab";
  ft: string;
};

export type ComposeHeaderInfo = {
  template?: string;
  provider?: string;
  out?: string;
  model?: string;
};

export type ComposeOpenPayload = {
  header: ComposeHeaderInfo;
  bodyLines: string[];
  config: ComposeEditorConfig;
};

type ComposeSessionState = {
  id: string;
  bufnr: number;
  winid: number;
  headerLines: number;
};

let composeSession: ComposeSessionState | null = null;

export function resolveComposeConfig(raw: unknown): ComposeEditorConfig {
  const ui = parseComposeUi(raw);
  const ft = (isRecord(raw) && typeof raw.ft === "string" && raw.ft.length > 0)
    ? raw.ft
    : "aitrans-compose.markdown";
  return { ui, ft };
}

export function buildComposeHeader(info: ComposeHeaderInfo): string[] {
  return [
    "# Aitrans Compose",
    `- Template: ${info.template ?? "n/a"}`,
    `- Provider: ${info.provider ?? "auto"}`,
    `- Output: ${info.out ?? "chat"}`,
    `- Model: ${info.model ?? "auto"}`,
    "---",
    "",
  ];
}

export function getComposeSession(): ComposeSessionState | null {
  return composeSession;
}

export async function openComposeEditor(
  denops: Denops,
  payload: ComposeOpenPayload,
): Promise<ComposeSessionState> {
  await closeComposeEditor(denops);
  const header = buildComposeHeader(payload.header);
  const body = payload.bodyLines.length > 0 ? payload.bodyLines : [""];
  const { bufnr, winid } = await createComposeWindow(denops, payload.config);
  await configureComposeBuffer(denops, bufnr, payload.config.ft);
  await buffer.modifiable(denops, bufnr, async () => {
    await fn.deletebufline(denops, bufnr, 1, "$");
    await fn.setbufline(denops, bufnr, 1, [...header, ...body]);
  });
  await installComposeKeymaps(denops, bufnr);
  composeSession = {
    id: crypto.randomUUID(),
    bufnr,
    winid,
    headerLines: header.length,
  };
  return composeSession;
}

export async function closeComposeEditor(denops: Denops): Promise<void> {
  if (composeSession == null) {
    return;
  }
  try {
    await denops.call("nvim_win_close", composeSession.winid, true);
  } catch {
    // ignore
  } finally {
    composeSession = null;
  }
}

export async function readComposeBody(denops: Denops): Promise<string> {
  if (composeSession == null) {
    throw new Error("aitrans: compose session is not active");
  }
  const lines = await fn.getbufline(
    denops,
    composeSession.bufnr,
    composeSession.headerLines + 1,
    "$",
  ) as string[];
  return lines.join("\n").trimEnd();
}

async function createComposeWindow(
  denops: Denops,
  config: ComposeEditorConfig,
): Promise<{ bufnr: number; winid: number }> {
  const bufnr = await denops.call("nvim_create_buf", false, true) as number;
  if (config.ui === "tab") {
    await denops.cmd("tabnew");
    const winid = await fn.win_getid(denops) as number;
    await denops.call("nvim_win_set_buf", winid, bufnr);
    return { bufnr, winid };
  }
  if (config.ui === "vsplit") {
    await denops.cmd("vsplit");
    const winid = await fn.win_getid(denops) as number;
    await denops.call("nvim_win_set_buf", winid, bufnr);
    return { bufnr, winid };
  }
  // float
  const columns = await denops.call("eval", "&columns") as number;
  const lines = await denops.call("eval", "&lines") as number;
  const width = Math.max(40, Math.floor(columns * 0.6));
  const height = Math.max(10, Math.floor(lines * 0.6));
  const row = Math.max(1, Math.floor((lines - height) / 2));
  const col = Math.max(1, Math.floor((columns - width) / 2));
  const winid = await denops.call(
    "nvim_open_win",
    bufnr,
    true,
    {
      relative: "editor",
      row,
      col,
      width,
      height,
      style: "minimal",
      border: "rounded",
    },
  ) as number;
  return { bufnr, winid };
}

async function configureComposeBuffer(
  denops: Denops,
  bufnr: number,
  ft: string,
): Promise<void> {
  await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
  await fn.setbufvar(denops, bufnr, "&bufhidden", "wipe");
  await fn.setbufvar(denops, bufnr, "&swapfile", 0);
  await fn.setbufvar(denops, bufnr, "&filetype", ft);
  await fn.setbufvar(denops, bufnr, "&modifiable", 1);
}

async function installComposeKeymaps(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  const name = denops.name;
  await mapping.map(
    denops,
    "<CR>",
    `<Cmd>call denops#notify("${name}", "composeSubmit", [])<CR>`,
    { buffer: true, noremap: true, silent: true, mode: ["n"] },
  );
  await mapping.map(
    denops,
    "q",
    `<Cmd>call denops#notify("${name}", "composeClose", [])<CR>`,
    { buffer: true, noremap: true, silent: true, mode: ["n"] },
  );
  await autocmd.define(
    denops,
    "BufWipeout",
    "<buffer>",
    `<Cmd>call denops#notify("${name}", "composeClose", [])<CR>`,
  );
}

function parseComposeUi(raw: unknown): ComposeEditorConfig["ui"] {
  if (isRecord(raw)) {
    if (raw.ui === "tab" || raw.ui === "vsplit" || raw.ui === "float") {
      return raw.ui;
    }
  }
  return "float";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
