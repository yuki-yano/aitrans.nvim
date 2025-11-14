import { assertEquals } from "../../deps/testing.ts";
import {
  buildPromptHeader,
  buildResponseBufferLines,
  resolveSelectionLines,
} from "./buffer_manager.ts";
import type { ChatOpenOptions } from "../types.ts";
import type { Denops } from "../../deps/denops.ts";

const noopDenops = {} as Denops;

Deno.test("buildPromptHeader includes template/provider/out defaults", () => {
  const header = buildPromptHeader({ template: "foo", provider: "openai" });
  assertEquals(header[0], "# Aitrans Prompt");
  assertEquals(header[1], "- Template: foo");
  assertEquals(header[2], "- Provider: openai");
  assertEquals(header[3], "- Output: chat");
});

Deno.test("buildResponseBufferLines returns default header when empty", () => {
  assertEquals(buildResponseBufferLines(), ["# Aitrans Response", ""]);
  assertEquals(buildResponseBufferLines(["custom"]), ["custom"]);
});

Deno.test("resolveSelectionLines prefers explicit selection data", async () => {
  const opts: ChatOpenOptions = {
    selection: "line1\nline2",
  };
  const lines = await resolveSelectionLines(noopDenops, opts);
  assertEquals(lines, ["line1", "line2"]);

  const opts2: ChatOpenOptions = {
    selection_lines: ["foo", "bar"],
  };
  assertEquals(await resolveSelectionLines(noopDenops, opts2), ["foo", "bar"]);
});
