import type { Denops } from "../deps/denops.ts";

/**
 * Check if window ID is valid via nvim_win_is_valid
 */
export async function winExists(
  denops: Denops,
  winid: number,
): Promise<boolean> {
  if (!winid) {
    return false;
  }
  try {
    return await denops.call("nvim_win_is_valid", winid) as boolean;
  } catch {
    return false;
  }
}

/**
 * Check if window is usable (valid and not floating)
 */
export async function isUsableWindow(
  denops: Denops,
  winid?: number,
): Promise<boolean> {
  if (!winid) {
    return false;
  }
  let valid = false;
  try {
    valid = await denops.call("nvim_win_is_valid", winid) as boolean;
  } catch {
    return false;
  }
  if (!valid) {
    return false;
  }
  try {
    const config = await denops.call(
      "nvim_win_get_config",
      winid,
    ) as Record<string, unknown>;
    const relative = typeof config.relative === "string" ? config.relative : "";
    return relative.length === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a usable window ID with fallback logic
 */
async function resolveUsableWindowId(
  denops: Denops,
  preferred?: number,
): Promise<number | null> {
  if (await isUsableWindow(denops, preferred)) {
    return preferred as number;
  }
  const current = await denops.call("nvim_get_current_win") as number;
  if (await isUsableWindow(denops, current)) {
    return current;
  }
  const wins = await denops.call("nvim_list_wins") as number[];
  for (const id of wins) {
    if (await isUsableWindow(denops, id)) {
      return id;
    }
  }
  return null;
}

/**
 * Focus a usable window with fallback logic
 */
export async function focusUsableWindow(
  denops: Denops,
  preferred?: number,
): Promise<boolean> {
  const target = await resolveUsableWindowId(denops, preferred);
  if (target == null) {
    return false;
  }
  try {
    await denops.call("nvim_set_current_win", target);
    return true;
  } catch {
    return false;
  }
}
