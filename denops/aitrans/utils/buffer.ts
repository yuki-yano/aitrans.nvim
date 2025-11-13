import type { Denops } from "../deps/denops.ts";
import { buffer } from "../deps/denops.ts";

/**
 * Check if buffer number is valid via nvim_buf_is_valid
 */
export async function bufferExists(
  denops: Denops,
  bufnr: number,
): Promise<boolean> {
  if (!bufnr) {
    return false;
  }
  try {
    return await denops.call("nvim_buf_is_valid", bufnr) as boolean;
  } catch {
    return false;
  }
}

/**
 * Wrapper for buffer.modifiable to perform operations with modifiable state
 */
export async function withModifiable<T>(
  denops: Denops,
  bufnr: number,
  fn: () => Promise<T>,
): Promise<T> {
  return await buffer.modifiable(denops, bufnr, fn);
}
