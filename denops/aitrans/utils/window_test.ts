import { assertEquals } from "../deps/testing.ts";
import type { Denops } from "../deps/denops.ts";
import { focusUsableWindow, isUsableWindow } from "./window.ts";

type MockOptions = {
  valid?: Record<number, boolean>;
  configs?: Record<number, { relative?: string }>;
  current?: number;
  wins?: number[];
  configThrows?: Set<number>;
  validThrows?: Set<number>;
  setThrows?: Set<number>;
};

function createMockDenops(options: MockOptions = {}) {
  const setCalls: number[] = [];
  const denops = {
    async call(method: string, ...args: unknown[]): Promise<unknown> {
      switch (method) {
        case "nvim_win_is_valid": {
          const id = args[0] as number;
          if (options.validThrows?.has(id)) {
            throw new Error("win_is_valid boom");
          }
          return options.valid?.[id] ?? false;
        }
        case "nvim_win_get_config": {
          const id = args[0] as number;
          if (options.configThrows?.has(id)) {
            throw new Error("win_get_config boom");
          }
          return options.configs?.[id] ?? {};
        }
        case "nvim_get_current_win": {
          return options.current ?? 1;
        }
        case "nvim_list_wins": {
          if (options.wins) {
            return options.wins;
          }
          return Object.keys(options.valid ?? {}).map((id) => Number(id));
        }
        case "nvim_set_current_win": {
          const id = args[0] as number;
          if (options.setThrows?.has(id)) {
            throw new Error("set_current boom");
          }
          setCalls.push(id);
          return undefined;
        }
        default:
          throw new Error(`unexpected call: ${method}`);
      }
    },
  } as unknown as Denops;
  return { denops, setCalls };
}

Deno.test("isUsableWindow rejects missing win ids and config failures", async () => {
  const { denops } = createMockDenops({
    valid: { 5: true },
    configThrows: new Set([5]),
  });
  assertEquals(await isUsableWindow(denops, undefined), false);
  assertEquals(await isUsableWindow(denops, 5), false);
});

Deno.test("isUsableWindow only accepts non-floating windows", async () => {
  const { denops } = createMockDenops({
    valid: { 10: true, 11: true },
    configs: {
      10: { relative: "" },
      11: { relative: "editor" },
    },
  });
  assertEquals(await isUsableWindow(denops, 10), true);
  assertEquals(await isUsableWindow(denops, 11), false);
});

Deno.test("focusUsableWindow prefers preferred id then falls back", async () => {
  const preferred = createMockDenops({
    valid: { 20: true },
    configs: { 20: { relative: "" } },
  });
  assertEquals(await focusUsableWindow(preferred.denops, 20), true);
  assertEquals(preferred.setCalls, [20]);

  const fallbackCurrent = createMockDenops({
    valid: { 30: false, 40: true },
    configs: { 40: { relative: "" } },
    current: 40,
    wins: [40],
  });
  assertEquals(await focusUsableWindow(fallbackCurrent.denops, 30), true);
  assertEquals(fallbackCurrent.setCalls, [40]);

  const fallbackList = createMockDenops({
    valid: { 50: false, 60: false, 70: true },
    configs: { 70: { relative: "" } },
    current: 60,
    wins: [70],
  });
  assertEquals(await focusUsableWindow(fallbackList.denops, 50), true);
  assertEquals(fallbackList.setCalls, [70]);
});
