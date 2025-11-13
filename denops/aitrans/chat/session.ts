import { normalizeFollowUps } from "./followup.ts";
import {
  chatActions,
  type ChatSessionState,
  type FollowUpItem,
  type ProviderContext,
} from "../store/chat.ts";
import { dispatch, store } from "../store/index.ts";

/**
 * Get the active chat session or null when not running.
 */
export function getActiveSession(): ChatSessionState | null {
  return store.getState().chat.session;
}

/**
 * Ensure chat session is active.
 */
export function assertActiveSession(): ChatSessionState {
  const session = getActiveSession();
  if (!session) {
    throw new Error("aitrans: chat session is not active");
  }
  return session;
}

/**
 * Retrieve provider context for CLI resume hooks.
 */
export function getActiveProviderContext(): ProviderContext | null {
  return getActiveSession()?.providerContext ?? null;
}

/**
 * Update provider context while preserving existing keys.
 */
export function updateProviderContext(context: ProviderContext): void {
  dispatch(chatActions.setProviderContext(context));
}

/**
 * Normalize and store follow-up entries.
 */
export function setFollowUps(payload: unknown): FollowUpItem[] {
  const items = normalizeFollowUps(payload) as FollowUpItem[];
  dispatch(chatActions.setFollowups(items));
  return items;
}
