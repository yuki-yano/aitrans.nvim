import { as, is, type Predicate } from "../deps/unknownutil.ts";

export type FollowUpEntry = {
  key: number;
  text: string;
};

const isFollowUpInput = is.ObjectOf({
  key: as.Optional(is.Number),
  text: is.String,
}) satisfies Predicate<{ key?: number; text: string }>;

export function normalizeFollowUps(payload: unknown): FollowUpEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const normalized: FollowUpEntry[] = [];
  for (const [idx, entry] of payload.entries()) {
    if (!isFollowUpInput(entry)) {
      continue;
    }
    const text = entry.text.trim();
    if (text.length === 0) {
      continue;
    }
    const key = clampKey(entry.key ?? normalized.length + 1);
    normalized.push({ key, text });
    if (normalized.length >= 4) {
      break;
    }
  }
  return normalized;
}

function clampKey(value: number): number {
  return Math.max(1, Math.min(4, Math.trunc(value)));
}
