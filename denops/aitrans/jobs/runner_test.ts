import { assertEquals } from "../deps/testing.ts";
import type { Denops } from "../deps/denops.ts";
import type { TemplateContext } from "../core/context.ts";
import type { ApplyOptions } from "../core/apply_options.ts";
import type { ExecutionPlan } from "./types.ts";
import { getAllJobs, getJob, registerJob } from "./manager.ts";
import { runJob } from "./runner.ts";

type SessionMock = {
  appended: string[];
  failed: unknown[];
  finalized: boolean;
  done: Promise<void>;
  session: {
    mode: "replace";
    append(text: string): Promise<void>;
    finalize(): Promise<void>;
    fail(reason: unknown): Promise<void>;
  };
};

function resetJobs() {
  getAllJobs().clear();
}

function createSessionMock(): SessionMock {
  const state = {
    appended: [] as string[],
    failed: [] as unknown[],
    finalized: false,
  };
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const session = {
    mode: "replace" as const,
    async append(text: string) {
      state.appended.push(text);
    },
    async finalize() {
      state.finalized = true;
      resolveDone();
    },
    async fail(reason: unknown) {
      state.failed.push(reason);
      resolveDone();
    },
  };
  return {
    get appended() {
      return state.appended;
    },
    get failed() {
      return state.failed;
    },
    get finalized() {
      return state.finalized;
    },
    done,
    session,
  };
}

function sampleContext(): TemplateContext {
  return {
    bufnr: 1,
    cwd: "/tmp",
    filepath: "/tmp/sample.txt",
    filename: "sample.txt",
    filetype: "text",
    source: "selection",
    selection: "",
    selection_lines: [],
    selection_bytes: 0,
    start_pos: { row: 1, col: 1 },
    end_pos: { row: 1, col: 1 },
    timestamp: Date.now() / 1000,
  };
}

function samplePlan(): ExecutionPlan {
  return {
    provider: "openai",
    providerPreset: { name: "openai" },
    model: "gpt-test",
    out: "replace",
    register: '"',
    requestArgs: {},
    followUp: false,
    chat: {},
  };
}

function sampleApplyOptions(): ApplyOptions {
  return {
    prompt: "Hello",
    provider: "openai",
    out: "replace",
  };
}

function noopDenops(): Denops {
  return {} as Denops;
}

async function flushRunner(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

Deno.test("runJob streams chunks and finalizes successfully", async () => {
  resetJobs();
  const job = registerJob("job-success");
  const mockSession = createSessionMock();
  async function* chunks() {
    yield { text_delta: "Hello" };
    yield { usage_partial: { input: 10 } };
  }
  runJob({
    job,
    denops: noopDenops(),
    session: mockSession.session,
    chunkIterator: chunks(),
    templateContext: sampleContext(),
    applyOptions: sampleApplyOptions(),
    executionPlan: samplePlan(),
  });
  await mockSession.done;
  await flushRunner();
  assertEquals(mockSession.appended, ["Hello"]);
  assertEquals(mockSession.finalized, true);
  assertEquals(job.status, "applied");
  assertEquals(getJob(job.id), undefined);
});

Deno.test("runJob handles aborted jobs by calling fail with Job stopped", async () => {
  resetJobs();
  const job = registerJob("job-stopped");
  const mockSession = createSessionMock();
  async function* chunks() {
    throw new Error("stream failure");
  }
  job.controller.abort();
  runJob({
    job,
    denops: noopDenops(),
    session: mockSession.session,
    chunkIterator: chunks(),
    templateContext: sampleContext(),
    applyOptions: sampleApplyOptions(),
    executionPlan: samplePlan(),
  });
  await mockSession.done;
  await flushRunner();
  assertEquals(job.status, "stopped");
  assertEquals(mockSession.failed, ["Job stopped"]);
  assertEquals(getJob(job.id), undefined);
});
