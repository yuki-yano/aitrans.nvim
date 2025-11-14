import { buffer, Denops, fn } from "../deps/denops.ts";
import { as, is } from "../deps/unknownutil.ts";
import {
  type ArchivedChat,
  chatActions,
  type ChatSessionState,
} from "../store/chat.ts";
import { dispatch, store } from "../store/index.ts";
import { assertActiveSession } from "./session.ts";
import type { ChatOpenOptions } from "./types.ts";
import {
  appendAssistantMessageToChat,
  appendUserMessageToChat,
} from "./messages.ts";

const isResumePayload = is.ObjectOf({
  id: as.Optional(is.String),
});

export function archiveChatSession(session: ChatSessionState): void {
  if (session.messages.length === 0) {
    return;
  }
  const entry: ArchivedChat = {
    id: session.id,
    template: session.template,
    provider: session.provider,
    followUpEnabled: session.followUpEnabled,
    createdAt: new Date().toISOString(),
    messages: [...session.messages],
    providerContext: session.providerContext,
  };
  dispatch(chatActions.archiveSession(entry));
}

export function listChatHistory(): ArchivedChat[] {
  return store.getState().chat.history;
}

export async function resumeChat(
  denops: Denops,
  payload: unknown,
  deps: {
    closeChat: (denops: Denops) => Promise<void>;
    createChatSession: (
      denops: Denops,
      opts: ChatOpenOptions,
    ) => Promise<ChatSessionState>;
  },
): Promise<void> {
  const history = listChatHistory();
  if (history.length === 0) {
    throw new Error("aitrans: no chat history to resume");
  }
  const resumeId = resolveResumeId(payload);
  const target = resumeId
    ? history.find((entry) => entry.id === resumeId)
    : history[0];
  if (!target) {
    throw new Error(`aitrans: chat history "${resumeId}" was not found`);
  }
  await deps.closeChat(denops);
  const session = await deps.createChatSession(denops, {
    template: target.template,
    provider: target.provider,
    follow_up: target.followUpEnabled,
    provider_context: target.providerContext,
  });
  dispatch(chatActions.startSession(session));
  dispatch(chatActions.setMessages([...target.messages]));
  const active = assertActiveSession();
  await resetResponseBuffer(denops, active);
  await resetPromptBuffer(denops, active);
  for (const message of target.messages) {
    if (message.role === "user") {
      await appendUserMessageToChat(denops, active, message.content, false);
    } else {
      await appendAssistantMessageToChat(
        denops,
        active,
        message.content,
        false,
      );
    }
  }
}

function resolveResumeId(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }
  if (isResumePayload(payload) && typeof payload.id === "string") {
    const trimmed = payload.id.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

async function resetResponseBuffer(
  denops: Denops,
  session: ChatSessionState,
): Promise<void> {
  await buffer.modifiable(denops, session.response.bufnr, async () => {
    await fn.deletebufline(denops, session.response.bufnr, 1, "$");
    await fn.setbufline(
      denops,
      session.response.bufnr,
      1,
      ["# Aitrans Response", ""],
    );
  });
}

async function resetPromptBuffer(
  denops: Denops,
  session: ChatSessionState,
): Promise<void> {
  await buffer.modifiable(denops, session.prompt.bufnr, async () => {
    await fn.deletebufline(
      denops,
      session.prompt.bufnr,
      session.headerLines + 1,
      "$",
    );
    await fn.appendbufline(
      denops,
      session.prompt.bufnr,
      session.headerLines,
      ["", ""],
    );
  });
}
