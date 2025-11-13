import { assertEquals } from "../../deps/testing.ts";
import {
  type CliProviderHooks,
  isCliProvider,
  mapClaudeResult,
  mapCodexEvent,
} from "./cli.ts";

Deno.test("isCliProvider recognizes CLI ids", () => {
  assertEquals(isCliProvider("codex-cli"), true);
  assertEquals(isCliProvider("claude-cli"), true);
  assertEquals(isCliProvider("openai"), false);
});

Deno.test("mapCodexEvent extracts agent message and usage", () => {
  const hooks: CliProviderHooks = { onThreadStarted: () => {} };
  const textChunk = mapCodexEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "hello" },
  }, hooks);
  assertEquals(textChunk, { text_delta: "hello" });

  const usageChunk = mapCodexEvent({
    type: "turn.completed",
    usage: { input_tokens: 10, output_tokens: 3 },
  }, hooks);
  assertEquals(usageChunk, {
    done: true,
    usage_partial: { input: 10, output: 3 },
  });
});

Deno.test("mapClaudeResult emits chunk and reports session id", () => {
  let sessionId: string | undefined;
  const chunk = mapClaudeResult({
    type: "result",
    result: "done",
    session_id: "abc",
    usage: { input_tokens: 5, output_tokens: 2 },
  }, { onSessionId: (id) => (sessionId = id) });
  assertEquals(sessionId, "abc");
  assertEquals(chunk, {
    text_delta: "done",
    done: true,
    usage_partial: { input: 5, output: 2 },
  });
});
