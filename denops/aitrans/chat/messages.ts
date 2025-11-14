import { buffer, Denops, fn } from "../deps/denops.ts";
import type { ChatSessionState } from "../store/chat.ts";
import { chatActions } from "../store/chat.ts";
import { dispatch } from "../store/index.ts";
import { appendLinesToResponse } from "./ui/buffer_manager.ts";
import { scrollResponseToEnd } from "./ui/window_manager.ts";

export async function appendUserMessageToChat(
  denops: Denops,
  session: ChatSessionState,
  text: string,
  record = true,
): Promise<void> {
  const lines = ["## User", ...text.split("\n")];
  await appendLinesToResponse(denops, session, lines);
  if (record) {
    dispatch(chatActions.pushMessage({ role: "user", content: text }));
  }
  await scrollResponseToEnd(denops, session);
  await restorePromptCursor(denops, session);
}

export async function appendAssistantMessageToChat(
  denops: Denops,
  session: ChatSessionState,
  text: string,
  record = true,
): Promise<void> {
  const lines = ["## Assistant", ...text.split("\n")];
  await appendLinesToResponse(denops, session, lines);
  if (record) {
    dispatch(chatActions.pushMessage({ role: "assistant", content: text }));
  }
  await scrollResponseToEnd(denops, session);
}

async function restorePromptCursor(
  denops: Denops,
  session: ChatSessionState,
): Promise<void> {
  await buffer.modifiable(denops, session.prompt.bufnr, async () => {
    await fn.win_gotoid(denops, session.prompt.winid);
    await fn.win_execute(
      denops,
      session.prompt.winid,
      `normal! ${session.headerLines + 1}G0`,
    );
  });
}
