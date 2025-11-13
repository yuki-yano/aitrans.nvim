import { as, is, type Predicate } from "../deps/unknownutil.ts";

export type ProviderDefinition = {
  model?: string;
  args?: Record<string, unknown> | string[];
  cli_args?: string[];
  command?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
};

export type FollowUpConfig = {
  enabled?: boolean;
};

export type ApiProviderName = "openai" | "claude" | "gemini";
export type CliProviderName = "codex-cli" | "claude-cli";

export type ApiProviderPreset = {
  name: ApiProviderName;
  model?: string;
  args?: Record<string, unknown>;
};

export type CliProviderPreset = {
  name: CliProviderName;
  cli_args?: string[];
};

export type ProviderPreset = ApiProviderPreset | CliProviderPreset;

export type ChatPreset = {
  split?: "vertical" | "tab";
  split_ratio?: number;
};

export type TemplateMetadata = {
  id: string;
  title?: string;
  desc?: string;
  default_out?: string;
  default_provider?: ProviderPreset;
  default_model?: string;
  default_request_args_json?: Record<string, unknown>;
  default_chat?: ChatPreset;
  follow_up?: boolean | FollowUpConfig;
};

export type RuntimeConfig = {
  providers: Record<string, ProviderDefinition>;
  templates: TemplateMetadata[];
  globals: Record<string, unknown>;
  chat: Record<string, unknown>;
  compose: Record<string, unknown>;
  timestamp: number | null;
};

const isJsonRecord =
  ((value: unknown): value is Record<string, unknown> =>
    is.Record(value)) satisfies Predicate<Record<string, unknown>>;
const isStringRecord: Predicate<Record<string, string>> = (
  value: unknown,
): value is Record<string, string> =>
  is.Record(value) &&
  Object.values(value).every((entry) => typeof entry === "string");
const isStringArray: Predicate<string[]> = is.ArrayOf(is.String);

const isApiProviderNameValue = (
  value: unknown,
): value is ApiProviderName =>
  value === "openai" || value === "claude" || value === "gemini";

const isCliProviderNameValue = (
  value: unknown,
): value is CliProviderName =>
  value === "codex-cli" || value === "claude-cli";

const isChatSplitValue = (
  value: unknown,
): value is "vertical" | "tab" =>
  value === "vertical" || value === "tab";

const isApiProviderPresetInput = is.ObjectOf({
  name: isApiProviderNameValue,
  model: as.Optional(is.String),
  args: as.Optional(isJsonRecord),
}) satisfies Predicate<ApiProviderPreset>;

const isCliProviderPresetInput = is.ObjectOf({
  name: isCliProviderNameValue,
  cli_args: as.Optional(isStringArray),
}) satisfies Predicate<CliProviderPreset>;

const isProviderPresetInput = is.UnionOf([
  isApiProviderPresetInput,
  isCliProviderPresetInput,
]) as Predicate<ProviderPreset>;

const isChatPresetInput = is.ObjectOf({
  split: as.Optional(isChatSplitValue),
  split_ratio: as.Optional(is.Number),
}) satisfies Predicate<ChatPreset>;

const isProviderDefinitionInput = is.ObjectOf({
  model: as.Optional(is.String),
  args: as.Optional(is.UnionOf([isJsonRecord, isStringArray])),
  cli_args: as.Optional(isStringArray),
  command: as.Optional(is.String),
  env: as.Optional(isStringRecord),
  timeout_ms: as.Optional(is.Number),
}) satisfies Predicate<ProviderDefinition>;
const isTemplateMetadataInput = is.ObjectOf({
  id: is.String,
  title: as.Optional(is.String),
  desc: as.Optional(is.String),
  default_out: as.Optional(is.String),
  default_provider: as.Optional(isProviderPresetInput),
  default_model: as.Optional(is.String),
  default_request_args_json: as.Optional(isJsonRecord),
  default_chat: as.Optional(isChatPresetInput),
  follow_up: as.Optional(
    is.UnionOf([
      is.Boolean,
      is.ObjectOf({
        enabled: as.Optional(is.Boolean),
      }),
    ]),
  ),
}) satisfies Predicate<TemplateMetadata>;

export function ensureConfig(value: unknown): RuntimeConfig {
  if (!is.Record(value)) {
    throw new Error("aitrans: config payload must be a dictionary");
  }

  const providers = normalizeProviders(value.providers);
  const templates = normalizeTemplates(value.templates);
  const globals = normalizeLooseObject(value.globals);
  const chat = normalizeLooseObject(value.chat);
  const compose = normalizeLooseObject(value.compose);
  const timestamp = is.Number(value.timestamp) ? value.timestamp : null;

  return {
    providers,
    templates,
    globals,
    chat,
    compose,
    timestamp,
  };
}

function normalizeProviders(
  value: unknown,
): Record<string, ProviderDefinition> {
  if (value === undefined) {
    return {};
  }
  if (!is.Record(value)) {
    throw new Error("aitrans: providers must be a dictionary");
  }
  const result: Record<string, ProviderDefinition> = {};
  for (const [name, definition] of Object.entries(value)) {
    if (!is.String(name)) {
      continue;
    }
    if (!isProviderDefinitionInput(definition)) {
      throw new Error(`aitrans: provider "${name}" has invalid definition`);
    }
    result[name] = { ...definition };
  }
  return result;
}

function normalizeTemplates(value: unknown): TemplateMetadata[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("aitrans: templates must be an array");
  }
  return value.map((entry, index) => {
    if (!isTemplateMetadataInput(entry)) {
      throw new Error(`aitrans: template[${index}] has invalid fields`);
    }
    return {
      ...entry,
      default_provider: entry.default_provider
        ? normalizeProviderPreset(entry.default_provider)
        : undefined,
      default_chat: entry.default_chat
        ? normalizeChatPreset(entry.default_chat)
        : undefined,
    };
  });
}

function normalizeLooseObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!is.Record(value)) {
    throw new Error("aitrans: configuration sections must be dictionaries");
  }
  return value as Record<string, unknown>;
}

export function normalizeProviderPreset(
  input: ProviderPreset | unknown,
): ProviderPreset {
  if (isApiProviderPresetInput(input)) {
    return {
      name: input.name,
      model: input.model,
      args: input.args ? { ...input.args } : undefined,
    };
  }
  if (isCliProviderPresetInput(input)) {
    return {
      name: input.name,
      cli_args: input.cli_args ? [...input.cli_args] : undefined,
    };
  }
  throw new Error("aitrans: provider preset is invalid");
}

export function normalizeChatPreset(input: ChatPreset | unknown): ChatPreset {
  if (!isChatPresetInput(input)) {
    throw new Error("aitrans: chat preset is invalid");
  }
  const preset: ChatPreset = {};
  if (input.split === "vertical" || input.split === "tab") {
    preset.split = input.split;
  }
  if (typeof input.split_ratio === "number" && Number.isFinite(input.split_ratio)) {
    preset.split_ratio = input.split_ratio;
  }
  return preset;
}
