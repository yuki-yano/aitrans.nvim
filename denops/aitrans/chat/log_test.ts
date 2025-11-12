import { assertEquals } from "../deps/testing.ts";
import { sanitizeLogName } from "./log.ts";

Deno.test("sanitizeLogName strips invalid characters", () => {
  assertEquals(sanitizeLogName("../foo:bar"), "foo-bar");
  assertEquals(sanitizeLogName("   "), "untitled");
});
