import { assertEquals } from "../deps/testing.ts";
import { normalizeChunk } from "./normalize.ts";

Deno.test("normalize openai chunk", () => {
  const chunk = normalizeChunk({
    provider: "openai",
    type: "response.output_text.delta",
    delta: "hello",
  });
  assertEquals(chunk?.text_delta, "hello");
});

Deno.test("normalize openai completion", () => {
  const chunk = normalizeChunk({
    provider: "openai",
    type: "response.completed",
  });
  assertEquals(chunk?.done, true);
});

Deno.test("normalize claude delta", () => {
  const chunk = normalizeChunk({
    provider: "claude",
    type: "content_block_delta",
    delta: { text: "world" },
  });
  assertEquals(chunk?.text_delta, "world");
});

Deno.test("normalize claude stop", () => {
  const chunk = normalizeChunk({
    provider: "claude",
    type: "message_stop",
  });
  assertEquals(chunk?.done, true);
});

Deno.test("normalize gemini", () => {
  const chunk = normalizeChunk({
    provider: "gemini",
    candidates: [{ content: { parts: [{ text: "foo" }, { text: "bar" }] } }],
  });
  assertEquals(chunk?.text_delta, "foobar");
});
