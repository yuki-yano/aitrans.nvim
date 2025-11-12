import { assertEquals } from "../deps/testing.ts";
import { normalizeFollowUps } from "./followup.ts";

Deno.test("normalizeFollowUpList clamps entries", () => {
  const input = [
    { key: 5, text: "A" },
    { key: 0, text: "B" },
    { text: "" },
    { text: " C " },
    { key: 2, text: "D" },
    { key: 3, text: "E" },
  ];
  const result = normalizeFollowUps(input);
  assertEquals(result.length, 4);
  assertEquals(result[0], { key: 4, text: "A" });
  assertEquals(result[1], { key: 1, text: "B" });
  assertEquals(result[2], { key: 3, text: "C" });
  assertEquals(result[3], { key: 2, text: "D" });
});
