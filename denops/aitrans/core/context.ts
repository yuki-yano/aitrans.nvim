import { Denops, fn } from "../deps/denops.ts";

export type Position = { row: number; col: number };

export type SelectionInfo = {
  source: "selection" | "line" | "buffer" | "none";
  text: string;
  lines: string[];
  start: Position;
  end: Position;
};

export type TemplateContext = {
  bufnr: number;
  cwd: string;
  filepath: string;
  filename: string;
  filetype: string;
  source: SelectionInfo["source"];
  selection: string;
  selection_lines: string[];
  selection_bytes: number;
  start_pos: Position;
  end_pos: Position;
  timestamp: number;
};

export type ApplyCallOptions = {
  source?: string;
  range?: [number, number];
  selection?: string;
};

type RangeInfo = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  source: SelectionInfo["source"];
};

export async function buildContext(
  denops: Denops,
  opts: ApplyCallOptions,
): Promise<TemplateContext> {
  const bufnr = await fn.bufnr(denops, "%") as number;
  const cwd = await fn.getcwd(denops) as string;
  const filepath = await fn.expand(denops, "%:p") as string;
  const filename = await fn.expand(denops, "%:t") as string;
  const filetype = await fn.getbufvar(denops, bufnr, "&filetype") as string;
  const selection = await resolveSelection(denops, bufnr, opts);
  return {
    bufnr,
    cwd,
    filepath,
    filename,
    filetype,
    source: selection.source,
    selection: selection.text,
    selection_lines: selection.lines,
    selection_bytes: new TextEncoder().encode(selection.text).length,
    start_pos: selection.start,
    end_pos: selection.end,
    timestamp: Date.now() / 1000,
  };
}

async function resolveSelection(
  denops: Denops,
  bufnr: number,
  opts: ApplyCallOptions,
): Promise<SelectionInfo> {
  if (typeof opts.selection === "string" && opts.selection.length > 0) {
    const lines = opts.selection.split("\n");
    return {
      source: (opts.source as SelectionInfo["source"]) ?? "selection",
      text: opts.selection,
      lines,
      start: { row: 1, col: 1 },
      end: { row: lines.length, col: lines.at(-1)?.length ?? 1 },
    };
  }

  const requestedSource = normalizeSource(opts.source);
  if (requestedSource === "none") {
    const row = await fn.line(denops, ".") as number;
    const col = await fn.col(denops, ".") as number;
    return {
      source: "none",
      text: "",
      lines: [],
      start: { row, col },
      end: { row, col },
    };
  }
  const range = await resolveRangeInfo(denops, bufnr, opts.range, requestedSource);
  if (range) {
    const lines = await fn.getbufline(denops, bufnr, range.startRow, range.endRow) as string[];
    const trimmed = trimLines(lines, range.startCol, range.endCol);
    return {
      source: range.source,
      lines: trimmed,
      text: trimmed.join("\n"),
      start: { row: range.startRow, col: range.startCol },
      end: { row: range.endRow, col: range.endCol },
    };
  }

  // Fallback to current line
  const lineNr = await fn.line(denops, ".") as number;
  const text = await fn.getline(denops, lineNr) as string;
  const endCol = text.length + 1;
  return {
    source: "line",
    lines: [text],
    text,
    start: { row: lineNr, col: 1 },
    end: { row: lineNr, col: endCol },
  };
}

async function resolveRangeInfo(
  denops: Denops,
  bufnr: number,
  explicit: [number, number] | undefined,
  requestedSource: SelectionInfo["source"],
): Promise<RangeInfo | null> {
  if (requestedSource === "buffer") {
    const last = await fn.line(denops, "$") as number;
    const endCol = await lineEndColumn(denops, last);
    return {
      startRow: 1,
      startCol: 1,
      endRow: last,
      endCol,
      source: "buffer",
    };
  }

  if (requestedSource === "line" && explicit == null) {
    const row = await fn.line(denops, ".") as number;
    const endCol = await lineEndColumn(denops, row);
    return {
      startRow: row,
      startCol: 1,
      endRow: row,
      endCol,
      source: "line",
    };
  }

  if (explicit && Number.isFinite(explicit[0]) && Number.isFinite(explicit[1])) {
    const startRow = Math.max(1, explicit[0]);
    const endRow = Math.max(startRow, explicit[1]);
    const endCol = await lineEndColumn(denops, endRow);
    return {
      startRow,
      startCol: 1,
      endRow,
      endCol,
      source: requestedSource === "line" ? "line" : "selection",
    };
  }

  const visual = await resolveVisualRange(denops);
  if (visual) {
    return { ...visual, source: "selection" };
  }

  if (requestedSource === "line") {
    const row = await fn.line(denops, ".") as number;
    const endCol = await lineEndColumn(denops, row);
    return {
      startRow: row,
      startCol: 1,
      endRow: row,
      endCol,
      source: "line",
    };
  }

  return null;
}

async function resolveVisualRange(denops: Denops): Promise<Omit<RangeInfo, "source"> | null> {
  const mode = await fn.mode(denops) as string;
  if (!(mode.startsWith("v") || mode.startsWith("V") || mode === "\u0016")) {
    return null;
  }
  const start = await fn.getpos(denops, "'<") as [number, number, number, number];
  const end = await fn.getpos(denops, "'>") as [number, number, number, number];
  const startRow = start[1];
  const startCol = Math.max(1, start[2]);
  const endRow = end[1];
  const endCol = Math.max(1, end[2]);
  if (startRow === 0 || endRow === 0) {
    return null;
  }
  if (startRow < endRow || (startRow === endRow && startCol <= endCol)) {
    return { startRow, startCol, endRow, endCol };
  }
  return { startRow: endRow, startCol: endCol, endRow: startRow, endCol: startCol };
}

function trimLines(lines: string[], startCol: number, endCol: number): string[] {
  if (lines.length === 0) {
    return [""];
  }
  if (lines.length === 1) {
    return [sliceLine(lines[0], startCol, endCol)];
  }
  const result = [...lines];
  result[0] = sliceLine(result[0], startCol);
  result[result.length - 1] = sliceLine(result[result.length - 1], 1, endCol);
  return result;
}

function sliceLine(line: string, startCol: number, endCol?: number): string {
  const startIdx = Math.max(0, startCol - 1);
  if (endCol === undefined) {
    return line.slice(startIdx);
  }
  const endIdx = Math.max(startIdx, endCol);
  return line.slice(startIdx, endIdx);
}

async function lineEndColumn(denops: Denops, row: number): Promise<number> {
  const text = await fn.getline(denops, row) as string;
  return text.length + 1;
}

function normalizeSource(value?: string): SelectionInfo["source"] {
  if (value === "buffer") return "buffer";
  if (value === "line") return "line";
  if (value === "none") return "none";
  return "selection";
}
