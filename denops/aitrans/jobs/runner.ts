import type { Denops } from "../deps/denops.ts";
import { logDebug } from "../core/logger.ts";
import type { ApplyOptions, OutputMode } from "../core/apply_options.ts";
import type { TemplateContext } from "../core/context.ts";
import type { TemplateMetadata } from "../core/config.ts";
import {
  buildTemplateCompletionContext,
  runTemplateCallback,
  type TemplateCompletionTarget,
  type TemplateCompletionUsage,
} from "../core/template.ts";
import type { NormalizedChunk } from "../stream/normalize.ts";
import { finalizeJob, updateJobStatus } from "./manager.ts";
import type { ExecutionPlan, JobOutputSession, JobRecord } from "./types.ts";

type RunJobOptions = {
  job: JobRecord;
  denops: Denops;
  session: JobOutputSession;
  chunkIterator: AsyncGenerator<NormalizedChunk>;
  templateId?: string | null;
  templateMeta?: TemplateMetadata | null;
  templateContext: TemplateContext;
  applyOptions: ApplyOptions;
  executionPlan: ExecutionPlan;
  chatSessionId?: string | null;
};

export function runJob(options: RunJobOptions): void {
  const {
    job,
    denops,
    session,
    chunkIterator,
    templateId,
    templateMeta,
    templateContext,
    applyOptions,
    executionPlan,
    chatSessionId,
  } = options;
  (async () => {
    try {
      job.status = "streaming";
      const responseChunks: string[] = [];
      let usage: TemplateCompletionUsage | undefined;
      for await (const chunk of chunkIterator) {
        if (chunk.text_delta) {
          responseChunks.push(chunk.text_delta);
          await session.append(chunk.text_delta);
        }
        if (chunk.usage_partial) {
          usage = {
            input_tokens: chunk.usage_partial.input ?? usage?.input_tokens,
            output_tokens: chunk.usage_partial.output ?? usage?.output_tokens,
          };
        }
      }
      await session.finalize();
      if (templateId) {
        try {
          const completionTarget = buildCompletionTarget(
            applyOptions.out,
            templateContext,
            executionPlan,
            chatSessionId,
          );
          const completionCtx = buildTemplateCompletionContext({
            templateMeta,
            templateId,
            templateContext,
            applyOptions,
            responseChunks,
            usage,
            target: completionTarget,
            completedAt: Date.now() / 1000,
            jobId: job.id,
          });
          await runTemplateCallback(denops, templateId, completionCtx);
        } catch (err) {
          await logDebug("aitrans.template.callback.error", {
            id: templateId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      job.status = "applied";
    } catch (err) {
      if (job.controller.signal.aborted) {
        job.status = "stopped";
        await session.fail("Job stopped");
        await logDebug("aitrans.apply.stopped", { id: job.id });
      } else {
        job.status = "error";
        await session.fail(err);
        await logDebug("aitrans.apply.error", {
          id: job.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      updateJobStatus(job.id, job.status);
      if (
        job.status === "applied" || job.status === "error" ||
        job.status === "stopped"
      ) {
        finalizeJob(job.id);
      }
    }
  })();
}

function buildCompletionTarget(
  out: OutputMode,
  ctx: TemplateContext,
  plan: ExecutionPlan,
  chatSessionId?: string | null,
): TemplateCompletionTarget {
  switch (out) {
    case "replace":
      return {
        type: "replace",
        bufnr: ctx.bufnr,
        range: { start: ctx.start_pos, end: ctx.end_pos },
      };
    case "append":
      return {
        type: "append",
        bufnr: ctx.bufnr,
        position: ctx.end_pos,
      };
    case "register":
      return {
        type: "register",
        register: plan.register,
      };
    case "scratch":
      return { type: "scratch" };
    case "chat":
      return { type: "chat", session_id: chatSessionId };
    default:
      return { type: "unknown" };
  }
}
