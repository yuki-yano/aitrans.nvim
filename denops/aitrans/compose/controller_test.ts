import { assertEquals } from "../deps/testing.ts";
import {
  buildComposeHeader,
  resolveComposeConfig,
  type ComposeHeaderInfo,
} from "./controller.ts";

Deno.test("buildComposeHeader constructs markdown header with blank separator", () => {
  const info: ComposeHeaderInfo = {
    template: "doc-chat",
    provider: "openai",
    out: "chat",
    model: "gpt-4.1",
  };
  const header = buildComposeHeader(info);
  assertEquals(header.slice(0, 4), [
    "# Aitrans Compose",
    "- Template: doc-chat",
    "- Provider: openai",
    "- Output: chat",
  ]);
  assertEquals(header.at(-2), "---");
  assertEquals(header.at(-1), "");
});

Deno.test("resolveComposeConfig falls back to defaults", () => {
  assertEquals(resolveComposeConfig(undefined), {
    ui: "float",
    ft: "aitrans-compose.markdown",
  });
  assertEquals(resolveComposeConfig({ ui: "tab", ft: "custom.ft" }), {
    ui: "tab",
    ft: "custom.ft",
  });
  assertEquals(resolveComposeConfig({ ui: "unknown" as never, ft: "" }), {
    ui: "float",
    ft: "aitrans-compose.markdown",
  });
});
