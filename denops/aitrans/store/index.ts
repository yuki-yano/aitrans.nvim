import { redux } from "../deps/store.ts";
import { configSlice } from "./config.ts";
import { chatSlice } from "./chat.ts";

const { configureStore } = redux;

export const store = configureStore({
  reducer: {
    config: configSlice.reducer,
    chat: chatSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const dispatch: AppDispatch = store.dispatch;

export const configActions = configSlice.actions;
export const chatActions = chatSlice.actions;
