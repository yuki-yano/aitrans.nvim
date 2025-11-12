import { assertEquals } from "../deps/testing.ts";
import type { TemplateContext } from "../core/context.ts";
import { buildComposeBodyLines } from "./body.ts";

function createContext(
  overrides: Partial<TemplateContext> = {},
): TemplateContext {
  return {
    bufnr: 1,
    cwd: "/tmp",
    filepath: "/tmp/test.txt",
    filename: "test.txt",
    filetype: "text",
    source: "selection",
    selection: "hello",
    selection_lines: ["hello"],
    selection_bytes: 5,
    start_pos: { row: 1, col: 1 },
    end_pos: { row: 1, col: 6 },
    timestamp: 0,
    ...overrides,
  };
}

Deno.test("buildComposeBodyLines returns prompt when provided", () => {
  const ctx = createContext({ filetype: "javascript" });
  const lines = buildComposeBodyLines("Prompt line", ctx);
  assertEquals(lines, ["Prompt line"]);
});

Deno.test("buildComposeBodyLines falls back to selection block when prompt empty", () => {
  const ctx = createContext({ selection_lines: ["hello"], filetype: "markdown" });
  const lines = buildComposeBodyLines("", ctx);
  assertEquals(lines, ["```markdown", "hello", "```"]);
});

Deno.test("buildComposeBodyLines returns blank line when both prompt and selection empty", () => {
  const ctx = createContext({ selection_lines: [], selection: "" });
  const lines = buildComposeBodyLines("", ctx);
  assertEquals(lines, [""]);
});
