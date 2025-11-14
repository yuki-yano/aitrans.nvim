import { assertEquals } from "../deps/testing.ts";
import {
  finalizeJob,
  getAllJobs,
  getJob,
  registerJob,
  stopJob,
  updateJobStatus,
} from "./manager.ts";

function resetJobs() {
  getAllJobs().clear();
}

Deno.test("registerJob stores pending job with AbortController", () => {
  resetJobs();
  const job = registerJob("job-1");
  assertEquals(job.status, "pending");
  assertEquals(job.controller.signal.aborted, false);
  assertEquals(getJob("job-1")?.id, "job-1");
});

Deno.test("updateJobStatus and stopJob mutate in-place", () => {
  resetJobs();
  registerJob("job-2");
  const updated = updateJobStatus("job-2", "streaming");
  assertEquals(updated, true);
  assertEquals(getJob("job-2")?.status, "streaming");
  const stopped = stopJob("job-2");
  assertEquals(stopped, true);
  assertEquals(getJob("job-2")?.status, "stopped");
  assertEquals(getJob("job-2")?.controller.signal.aborted, true);
});

Deno.test("finalizeJob removes entries and later updates fail", () => {
  resetJobs();
  registerJob("job-3");
  finalizeJob("job-3");
  assertEquals(getJob("job-3"), undefined);
  assertEquals(updateJobStatus("job-3", "error"), false);
  assertEquals(stopJob("job-3"), false);
});
