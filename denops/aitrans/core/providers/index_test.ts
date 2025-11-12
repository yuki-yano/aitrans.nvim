import { assertEquals } from "../../deps/testing.ts";
import { executeProvider } from "./index.ts";

const encoder = new TextEncoder();

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

Deno.test("executeProvider(openai) normalizes SSE chunks", async () => {
  const body = createSSEStream([
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
    'data: {"type":"response.completed"}\n\n',
  ]);
  const mockFetch = () => Promise.resolve(new Response(body));
  const chunks: Array<string | boolean> = [];
  for await (
    const chunk of executeProvider({
      provider: "openai",
      apiKey: "test",
      model: "gpt",
      messages: [{ role: "user", content: "Hi" }],
      fetchImpl: mockFetch,
    })
  ) {
    if (chunk.text_delta) {
      chunks.push(chunk.text_delta);
    }
    if (chunk.done) {
      chunks.push(chunk.done);
    }
  }
  assertEquals(chunks, ["Hello", true]);
});
