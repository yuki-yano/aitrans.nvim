import type { TemplateContext } from "../core/context.ts";

export function buildComposeBodyLines(
  prompt: string,
  ctx: TemplateContext,
): string[] {
  if (prompt.length > 0) {
    return prompt.split("\n");
  }
  const selectionLines = ctx.selection_lines ?? [];
  if (selectionLines.length > 0) {
    const lang = ctx.filetype && ctx.filetype.length > 0 ? ctx.filetype : "";
    return [
      lang.length > 0 ? `\`\`\`${lang}` : "```",
      ...selectionLines,
      "```",
    ];
  }
  return [""];
}
