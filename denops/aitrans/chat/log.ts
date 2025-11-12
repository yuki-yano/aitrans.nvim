const SAFE_NAME = /[^a-zA-Z0-9-_]+/g;

export function sanitizeLogName(input: string | null | undefined): string {
  const base = (input ?? "").trim().replace(SAFE_NAME, "-");
  const sanitized = base.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized : "untitled";
}
