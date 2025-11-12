import { assertEquals } from "../deps/testing.ts";
import { logMessage } from "./logger.ts";
import { configActions } from "../store/config.ts";
import { dispatch } from "../store/index.ts";

type StubDenops = {
  logs: Array<{ level: string; payload: string }>;
};

function createStubDenops(): StubDenops & Record<string, unknown> {
  return {
    logs: [],
    log(level: string, ...args: unknown[]) {
      this.logs.push({ level, payload: args.join(" ") });
    },
    async call() {
      return null;
    },
  };
}

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
  const denops = createStubDenops();
  setDebugFlag(false);
  await logMessage(denops as unknown as Parameters<typeof logMessage>[0], "debug", "hello");
  assertEquals(denops.logs.length, 0);
});

Deno.test("logMessage emits debug logs when enabled", async () => {
  const denops = createStubDenops();
  setDebugFlag(true);
  await logMessage(denops as unknown as Parameters<typeof logMessage>[0], "debug", "hello");
  assertEquals(denops.logs.length, 1);
  assertEquals(denops.logs[0].level, "debug");
});
