import { assertEquals, assertThrows } from "../deps/testing.ts";
import {
  assertActiveSession,
  getActiveProviderContext,
  setFollowUps,
  updateProviderContext,
} from "./session.ts";
import { chatActions } from "../store/chat.ts";
import { store } from "../store/index.ts";
import type { ChatSessionState } from "../store/chat.ts";

function mockSession(
  overrides: Partial<ChatSessionState> = {},
): ChatSessionState {
  return {
    id: crypto.randomUUID(),
    prompt: { tabnr: 1, winid: 100, bufnr: 10 },
    response: { tabnr: 1, winid: 101, bufnr: 11 },
    headerLines: 4,
    followups: [],
    followUpEnabled: false,
    template: "demo",
    provider: "codex-cli",
    layout_mode: "split",
    origin_winid: 1,
    messages: [],
    streaming: false,
    ...overrides,
  };
}

function withSession(
  overrides: Partial<ChatSessionState>,
  fn: () => void,
): void {
  store.dispatch(chatActions.startSession(mockSession(overrides)));
  try {
    fn();
  } finally {
    store.dispatch(chatActions.endSession());
  }
}

Deno.test("setFollowUps normalizes payload and updates store", () => {
  withSession({}, () => {
    const items = setFollowUps([
      { text: " First " },
      { text: "" },
      { key: 9, text: "Second" },
    ]);
    assertEquals(items, [
      { key: 1, text: "First" },
      { key: 4, text: "Second" },
    ]);
    assertEquals(store.getState().chat.session?.followups, items);
  });
});

Deno.test("updateProviderContext merges values for same provider", () => {
  withSession(
    { providerContext: { provider: "codex-cli", thread_id: "abc" } },
    () => {
      updateProviderContext({ provider: "codex-cli", session_id: "s1" });
      assertEquals(store.getState().chat.session?.providerContext, {
        provider: "codex-cli",
        thread_id: "abc",
        session_id: "s1",
      });
      updateProviderContext({ provider: "claude-cli", session_id: "s2" });
      assertEquals(store.getState().chat.session?.providerContext, {
        provider: "codex-cli",
        thread_id: "abc",
        session_id: "s1",
      });
    },
  );
});

Deno.test("assertActiveSession throws when no session is active", () => {
  store.dispatch(chatActions.endSession());
  assertThrows(() => assertActiveSession());
});

Deno.test("getActiveProviderContext returns null when no context", () => {
  store.dispatch(
    chatActions.startSession(mockSession({ providerContext: undefined })),
  );
  try {
    assertEquals(getActiveProviderContext(), null);
  } finally {
    store.dispatch(chatActions.endSession());
  }
});

Deno.test("getActiveProviderContext returns context when set", () => {
  const context = { provider: "codex-cli", thread_id: "xyz" };
  store.dispatch(
    chatActions.startSession(mockSession({ providerContext: context })),
  );
  try {
    assertEquals(getActiveProviderContext(), context);
  } finally {
    store.dispatch(chatActions.endSession());
  }
});
