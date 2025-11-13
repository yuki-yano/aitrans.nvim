import { type PayloadAction, redux } from "../deps/store.ts";

const { createSlice } = redux;

export type BufferWindow = {
  tabnr: number;
  winid: number;
  bufnr: number;
};

export type FollowUpItem = {
  key: number;
  text: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatSessionState = {
  id: string;
  prompt: BufferWindow;
  response: BufferWindow;
  headerLines: number;
  followups: FollowUpItem[];
  followUpEnabled: boolean;
  template?: string;
  provider?: string;
  layout_mode: "tab" | "split";
  origin_winid?: number;
  messages: ChatMessage[];
  streaming: boolean;
  providerContext?: ProviderContext;
};

export type ArchivedChat = {
  id: string;
  template?: string;
  provider?: string;
  followUpEnabled: boolean;
  createdAt: string;
  messages: ChatMessage[];
  providerContext?: ProviderContext;
};

export type ProviderContext = {
  provider: string;
  thread_id?: string;
  session_id?: string;
};

export type ChatState = {
  session: ChatSessionState | null;
  history: ArchivedChat[];
};

const HISTORY_LIMIT = 20;

const initialState: ChatState = {
  session: null,
  history: [],
};

export const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    startSession(state, action: PayloadAction<ChatSessionState>) {
      state.session = action.payload;
    },
    endSession(state) {
      state.session = null;
    },
    setFollowups(state, action: PayloadAction<FollowUpItem[]>) {
      if (state.session) {
        state.session.followups = action.payload;
      }
    },
    setMessages(state, action: PayloadAction<ChatMessage[]>) {
      if (state.session) {
        state.session.messages = action.payload;
      }
    },
    pushMessage(state, action: PayloadAction<ChatMessage>) {
      if (state.session) {
        state.session.messages.push(action.payload);
      }
    },
    setStreaming(state, action: PayloadAction<boolean>) {
      if (state.session) {
        state.session.streaming = action.payload;
      }
    },
    setProviderContext(state, action: PayloadAction<ProviderContext | null>) {
      if (state.session && action.payload) {
        if (
          state.session.provider &&
          state.session.provider !== action.payload.provider
        ) {
          return;
        }
        state.session.providerContext = {
          ...(state.session.providerContext ??
            { provider: action.payload.provider }),
          ...action.payload,
        };
      }
    },
    archiveSession(state, action: PayloadAction<ArchivedChat>) {
      state.history = [action.payload, ...state.history].slice(
        0,
        HISTORY_LIMIT,
      );
    },
  },
});

export const chatActions = chatSlice.actions;
