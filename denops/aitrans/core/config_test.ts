import { assertEquals, assertThrows } from "../deps/testing.ts";
import { ensureConfig } from "./config.ts";

Deno.test("ensureConfig accepts well-formed payload", () => {
  const result = ensureConfig({
    providers: {
      openai: {
        model: "gpt-5-mini",
        args: { temperature: 0.1 },
      },
    },
    templates: [
      {
        id: "explain",
        title: "Explain",
        default_out: "chat",
      },
    ],
    globals: {
      debug: true,
    },
    chat: {
      split: "vertical",
    },
    compose: {
      ui: "float",
    },
  });

  assertEquals(result.providers.openai?.model, "gpt-5-mini");
  assertEquals(result.templates[0]?.id, "explain");
  assertEquals(result.globals?.debug, true);
});

Deno.test("ensureConfig rejects invalid provider definitions", () => {
  assertThrows(() =>
    ensureConfig({
      providers: {
        openai: { model: 42 },
      },
      templates: [],
    })
  );
});

Deno.test("ensureConfig rejects template entries without id", () => {
  assertThrows(() =>
    ensureConfig({
      providers: {},
      templates: [
        { title: "no-id" },
      ],
    })
  );
});
