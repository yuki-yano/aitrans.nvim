import { assertEquals, assertThrows } from "../deps/testing.ts";
import { buildMessages, ensureApplyOptions } from "./apply_options.ts";

Deno.test("ensureApplyOptions requires prompt", () => {
  assertThrows(() => ensureApplyOptions({}), "prompt is required");
});

Deno.test("ensureApplyOptions defaults provider/out", () => {
  const opts = ensureApplyOptions({ prompt: "hi" });
  assertEquals(opts.provider, "openai");
  assertEquals(opts.out, "scratch");
});

Deno.test("ensureApplyOptions falls back to openai for unknown provider", () => {
  const opts = ensureApplyOptions({ prompt: "hi", provider: "foo" });
  assertEquals(opts.provider, "openai");
});

Deno.test("buildMessages includes system when provided", () => {
  const opts = ensureApplyOptions({ prompt: "hi", system: "role" });
  const messages = buildMessages(opts);
  assertEquals(messages.length, 2);
  assertEquals(messages[0], { role: "system", content: "role" });
});
