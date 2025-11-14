import type { OutputMode, Provider } from "../core/apply_options.ts";
import type { ChatPreset, ProviderPreset } from "../core/config.ts";
import type { OutputSession } from "../core/output.ts";
import type { ChatOutputSession } from "../chat/controller.ts";

export type JobStatus =
  | "pending"
  | "streaming"
  | "applied"
  | "error"
  | "stopped";

export type JobRecord = {
  id: string;
  status: JobStatus;
  controller: AbortController;
};

export type JobSummary = {
  id: string;
  status: JobStatus;
  out: string;
};

export type JobOutputSession = OutputSession | ChatOutputSession;

export type ExecutionPlan = {
  provider: Provider;
  providerPreset: ProviderPreset;
  model?: string;
  out: OutputMode;
  register: string;
  requestArgs: Record<string, unknown>;
  followUp: boolean;
  chat: ChatPreset;
  cliArgsOverride?: string[];
};
