import { as, is, type Predicate } from "../deps/unknownutil.ts";

export type ProviderDefinition = {
  model?: string;
  args?: Record<string, unknown>;
};

export type FollowUpConfig = {
  enabled?: boolean;
};

export type TemplateMetadata = {
  id: string;
  title?: string;
  desc?: string;
  default_out?: string;
  default_provider?: string;
  default_model?: string;
  default_request_args_json?: Record<string, unknown>;
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
const isProviderDefinitionInput = is.ObjectOf({
  model: as.Optional(is.String),
  args: as.Optional(isJsonRecord),
}) satisfies Predicate<ProviderDefinition>;
const isTemplateMetadataInput = is.ObjectOf({
  id: is.String,
  title: as.Optional(is.String),
  desc: as.Optional(is.String),
  default_out: as.Optional(is.String),
  default_provider: as.Optional(is.String),
  default_model: as.Optional(is.String),
  default_request_args_json: as.Optional(isJsonRecord),
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
    return { ...entry };
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
