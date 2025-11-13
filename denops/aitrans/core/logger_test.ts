import { assertEquals } from "../deps/testing.ts";
import { logMessage } from "./logger.ts";
import { configActions } from "../store/config.ts";
import { dispatch } from "../store/index.ts";

function setDebugFlag(enabled: boolean) {
  dispatch(configActions.setRuntimeConfig({
    providers: {},
    templates: [],
    globals: { debug: enabled },
    chat: {},
    compose: {},
    timestamp: null,
  }));
}

Deno.test("logMessage skips debug logs when disabled", async () => {
  setDebugFlag(false);
  const outputs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => outputs.push(args.join(" "));
  try {
    await logMessage("debug", "hello");
  } finally {
    console.log = original;
  }
  assertEquals(outputs.length, 0);
});

Deno.test("logMessage emits debug logs when enabled", async () => {
  setDebugFlag(true);
  const outputs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => outputs.push(args.join(" "));
  try {
    await logMessage("debug", "hello");
  } finally {
    console.log = original;
  }
  assertEquals(outputs.length, 1);
  assertEquals(outputs[0], "[DEBUG] hello");
});
