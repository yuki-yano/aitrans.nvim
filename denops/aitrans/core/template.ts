import { Denops } from "../deps/denops.ts";
import { is } from "../deps/unknownutil.ts";
import type { TemplateContext } from "./context.ts";
import type { TemplateMetadata } from "./config.ts";

export type PromptBlock = {
  prompt: string;
  system?: string;
};

export async function runTemplateBuilder(
  denops: Denops,
  templateId: string,
  ctx: TemplateContext,
  args: Record<string, unknown>,
): Promise<PromptBlock> {
  const result = await denops.call(
    "aitrans#template#execute",
    templateId,
    ctx,
    args,
  );
  if (typeof result === "string") {
    return { prompt: result };
  }
  if (is.Record(result) && typeof result.prompt === "string") {
    return {
      prompt: result.prompt,
      system: typeof result.system === "string" ? result.system : undefined,
    };
  }
  throw new Error(`aitrans: template "${templateId}" returned invalid result`);
}

export function findTemplateMetadata(
  templates: TemplateMetadata[],
  templateId?: string,
): TemplateMetadata | null {
  if (!templateId) {
    return null;
  }
  return templates.find((entry) => entry.id === templateId) ?? null;
}
