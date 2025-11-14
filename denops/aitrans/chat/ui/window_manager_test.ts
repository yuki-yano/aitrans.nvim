import { assertEquals } from "../../deps/testing.ts";
import { clampSplitRatio } from "./window_manager.ts";

Deno.test("clampSplitRatio clamps values between 0.05 and 0.95", () => {
  assertEquals(clampSplitRatio(0.5), 0.5);
  assertEquals(clampSplitRatio(0), 0.05);
  assertEquals(clampSplitRatio(1.5), 0.95);
  assertEquals(clampSplitRatio(undefined), 0.66);
});
