import { as, is, type Predicate } from "../deps/unknownutil.ts";

export type SplitInput = "vertical" | "tab";
export type RangeTuple = [number, number];

export type ChatOpenOptions = {
  template?: string;
  provider?: string;
  out?: string;
  follow_up?: boolean;
  selection?: string;
  selection_lines?: string[];
  initial_response_lines?: string[];
  split?: SplitInput;
  range?: RangeTuple;
  source_bufnr?: number;
  split_ratio?: number;
  provider_context?: {
    provider: string;
    thread_id?: string;
    session_id?: string;
  };
};

export const isSplitInput: Predicate<SplitInput> = (
  value: unknown,
): value is SplitInput => value === "vertical" || value === "tab";

export const isRangeTuple = is.TupleOf([
  is.Number,
  is.Number,
]) satisfies Predicate<RangeTuple>;

export const isChatOpenPayload = is.ObjectOf({
  template: as.Optional(is.String),
  provider: as.Optional(is.String),
  out: as.Optional(is.String),
  follow_up: as.Optional(is.Boolean),
  selection: as.Optional(is.String),
  selection_lines: as.Optional(is.ArrayOf(is.String)),
  initial_response_lines: as.Optional(is.ArrayOf(is.String)),
  split: as.Optional(isSplitInput),
  range: as.Optional(isRangeTuple),
  source_bufnr: as.Optional(is.Number),
  split_ratio: as.Optional(is.Number),
  provider_context: as.Optional(
    is.ObjectOf({
      provider: is.String,
      thread_id: as.Optional(is.String),
      session_id: as.Optional(is.String),
    }),
  ),
}) satisfies Predicate<ChatOpenOptions>;
