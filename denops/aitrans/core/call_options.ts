import { is } from "../deps/unknownutil.ts";
import {
  type ChatPreset,
  normalizeChatPreset,
  normalizeProviderPreset,
  type ProviderPreset,
} from "./config.ts";
import type { ApplyCallOptions as ContextCallOptions } from "./context.ts";
import { asOptionalString } from "../utils/validation.ts";

export type ApplyCallOptions = ContextCallOptions & {
  template?: string;
  prompt_override?: string;
  system_override?: string;
  provider?: ProviderPreset;
  model?: string;
  out?: string;
  register?: string;
  args?: Record<string, unknown>;
  request_args_json?: Record<string, unknown>;
  follow_up?: boolean;
  chat?: ChatPreset;
};

const isRangeTuple = is.TupleOf([is.Number, is.Number]);

export function ensureApplyCallOptions(payload: unknown): ApplyCallOptions {
  if (!is.Record(payload)) {
    return {};
  }
  let providerPreset: ProviderPreset | undefined;
  if (payload.provider !== undefined) {
    providerPreset = normalizeProviderPreset(payload.provider);
  }
  let chatPreset: ChatPreset | undefined;
  if (payload.chat !== undefined) {
    chatPreset = normalizeChatPreset(payload.chat);
  }
  return {
    template: asOptionalString(payload.template),
    prompt_override: asOptionalString(payload.prompt_override),
    system_override: asOptionalString(payload.system_override),
    provider: providerPreset,
    model: asOptionalString(payload.model),
    out: asOptionalString(payload.out),
    selection: asOptionalString(payload.selection),
    source: asOptionalString(payload.source),
    register: asOptionalString(payload.register),
    range: isRangeTuple(payload.range)
      ? [payload.range[0], payload.range[1]]
      : undefined,
    args: is.Record(payload.args)
      ? payload.args as Record<string, unknown>
      : undefined,
    request_args_json: is.Record(payload.request_args_json)
      ? payload.request_args_json as Record<string, unknown>
      : undefined,
    follow_up: typeof payload.follow_up === "boolean"
      ? payload.follow_up
      : undefined,
    chat: chatPreset,
  };
}
