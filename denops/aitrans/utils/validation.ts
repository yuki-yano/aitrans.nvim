import { is } from "../deps/unknownutil.ts";

/**
 * Check if value is a plain object (Record)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return is.Record(value);
}

/**
 * Ensure value is an array of strings
 */
export function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Check if value is a valid positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Extract optional string (non-empty) from unknown value
 */
export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
