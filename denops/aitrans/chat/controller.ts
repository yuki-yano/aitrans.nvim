import { Denops } from "../deps/denops.ts";
import {
  type ChatLogRecord,
  type ChatLogSummary,
  listChatLogs as listChatLogSummaries,
  loadChatLog as loadChatLogRecord,
  saveChatLog as saveChatLogRecord,
} from "./log.ts";
import {
  applyFollowUpText,
  capturePromptInput,
  createChatOutputSession,
  resolveSelectionLines,
} from "./ui/buffer_manager.ts";
import type { ChatOutputSession } from "./ui/buffer_manager.ts";
import { closeChatWindows } from "./ui/window_manager.ts";
import {
  createChatSession,
  ensureChatOpenOptions,
} from "./ui/session_factory.ts";
import {
  assertActiveSession,
  getActiveSession,
  setFollowUps as setSessionFollowUps,
} from "./session.ts";
import { chatActions } from "../store/chat.ts";
import { dispatch } from "../store/index.ts";
import { resolveFollowUpIndex } from "./followup.ts";
import {
  archiveChatSession as archiveSessionRecord,
  listChatHistory as listChatHistoryImpl,
  resumeChat as resumeChatImpl,
} from "./archive.ts";
export {
  appendAssistantMessageToChat,
  appendUserMessageToChat,
} from "./messages.ts";
export type { ChatOutputSession };
export { createChatOutputSession };
export async function openChat(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const opts = ensureChatOpenOptions(payload);
  const selectionLines = await resolveSelectionLines(denops, opts);
  await closeChat(denops);
  const session = await createChatSession(denops, {
    ...opts,
    selection_lines: selectionLines ?? opts.selection_lines,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setStreaming(false));
}

export async function closeChat(denops: Denops): Promise<void> {
  const current = getActiveSession();
  if (current == null) {
    return;
  }
  dispatch(chatActions.setStreaming(false));
  archiveSessionRecord(current);
  dispatch(chatActions.endSession());
  await closeChatWindows(denops, current);
}

export async function submitChat(
  denops: Denops,
): Promise<string | null> {
  const current = getActiveSession();
  if (current == null) {
    return null;
  }
  return await capturePromptInput(denops, current);
}

export async function applyFollowUp(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const current = getActiveSession();
  if (current == null) {
    return;
  }
  const index = resolveFollowUpIndex(payload);
  if (index == null) {
    return;
  }
  const item = current.followups.find((entry) => entry.key === index);
  if (!item) {
    return;
  }
  await applyFollowUpText(denops, current, item.text);
}

export function setFollowUps(
  _denops: Denops,
  payload: unknown,
): void {
  setSessionFollowUps(payload);
}

export async function listChatLogs(
  denops: Denops,
): Promise<ChatLogSummary[]> {
  return await listChatLogSummaries(denops);
}

export async function saveChatLog(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const session = assertActiveSession();
  await saveChatLogRecord(denops, session, payload);
}

export async function loadChatLog(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  const record: ChatLogRecord = await loadChatLogRecord(denops, payload);
  await closeChat(denops);
  const session = await createChatSession(denops, {
    template: record.template,
    provider: record.provider,
    follow_up: record.follow_up_enabled,
    selection_lines: record.prompt_text.split("\n"),
    initial_response_lines: record.response_text.split("\n"),
    provider_context: record.provider_context,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setFollowups(record.followups ?? []));
}

export const listChatHistory = listChatHistoryImpl;

export async function resumeChat(
  denops: Denops,
  payload: unknown,
): Promise<void> {
  await resumeChatImpl(denops, payload, {
    closeChat,
    createChatSession,
  });
}
