import { type PayloadAction, redux } from "../deps/store.ts";
import type { RuntimeConfig } from "../core/config.ts";

const { createSlice } = redux;

export type ConfigState = {
  runtime: RuntimeConfig | null;
};

const initialState: ConfigState = {
  runtime: null,
};

export const configSlice = createSlice({
  name: "config",
  initialState,
  reducers: {
    setRuntimeConfig(state, action: PayloadAction<RuntimeConfig>) {
      state.runtime = action.payload;
    },
  },
});

export const configActions = configSlice.actions;
