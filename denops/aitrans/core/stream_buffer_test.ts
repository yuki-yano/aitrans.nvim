import { assertEquals } from "../deps/testing.ts";
import { createStreamingBuffer } from "./stream_buffer.ts";

Deno.test("StreamingBuffer appends text with newline awareness", () => {
  const buffer = createStreamingBuffer();
  assertEquals(buffer.getLines(), [""]);

  assertEquals(buffer.append("Hello"), ["Hello"]);
  assertEquals(buffer.append("\nWorld"), ["Hello", "World"]);
  assertEquals(buffer.append("!"), ["Hello", "World!"]);
  assertEquals(buffer.append("\n"), ["Hello", "World!", ""]);

  buffer.clear();
  assertEquals(buffer.getLines(), [""]);
  assertEquals(buffer.append("Line1\nLine2\nLine3"), [
    "Line1",
    "Line2",
    "Line3",
  ]);

  buffer.append("\nTail");
  assertEquals(buffer.drainText(), "Line1\nLine2\nLine3\nTail");
  assertEquals(buffer.getLines(), [""]);
});
