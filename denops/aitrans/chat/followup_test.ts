import { assertEquals } from "../deps/testing.ts";
import { normalizeFollowUps } from "./followup.ts";

Deno.test("normalizeFollowUps keeps up to 4 entries", () => {
  const items = normalizeFollowUps([
    { key: 5, text: " A " },
    { key: 0, text: "" },
    { text: "B" },
    { text: "C" },
    { text: "D" },
    { text: "E" },
  ]);
  assertEquals(items.length, 4);
  assertEquals(items[0], { key: 4, text: "A" });
  assertEquals(items[1], { key: 2, text: "B" });
});
