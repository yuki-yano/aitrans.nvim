# aitrans.nvim

AI-assisted editing toolkit for Neovim powered by Denops and Deno. Templates defined in Vimscript/Lua turn visual selections or buffers into prompts that are streamed to OpenAI, Claude, Gemini, or other HTTP providers. Output can be applied back into the buffer, appended beneath a selection, written to a register, streamed into a scratch buffer, or displayed in a two-pane chat UI that mirrors the ergonomics of [ai-review.vim](https://github.com/yuki-yano/ai-review.vim).

> **Status:** v0.4.0 is a full rewrite. All configuration lives under `g:aitrans_*`, the bridge to providers is TypeScript-only, and chat/compose flows have been redesigned (split UI, streaming, in-memory history, optional follow-ups).

---

## Requirements

- **Editor:** Neovim ≥ 0.11 (Vim 8.2 works but is not QA’d) with [denops.vim](https://github.com/vim-denops/denops.vim)
- **Runtime:** Deno ≥ 2.5.6
- **Providers:** Any HTTP endpoint the TypeScript layer knows how to call (built-ins: OpenAI Responses API, Claude Messages API, Gemini `streamGenerateContent`)

---

## Installation

1. Install `denops.vim` first (via your preferred plugin manager).
2. Install `aitrans.nvim` from this repository.
3. Ensure `deno` is on `$PATH`.
4. Define configuration globals before the plugin loads:

```lua
-- init.lua
vim.g.aitrans_chat = {
  log_dir = vim.fn.expand("~/.cache/vim/aitrans"),
  split = "vertical",      -- "vertical" | "horizontal" | "float"
  history_limit = 200,
}

vim.g.aitrans_compose = {
  ui = "float",            -- "float" | "vsplit" | "tab"
  ft = "aitrans-compose.markdown",
}

vim.g.aitrans_providers = {
  openai = {
    model = "gpt-5-mini",
    args = { reasoning = { effort = "minimal" } },
  },
  claude = {
    model = "claude-3-5-sonnet-20240620",
  },
}
```

Call `denops#plugin#load('aitrans', {})` (or let your manager do it) after the globals are set so runtime config sync succeeds.

---

## Templates

Templates live in `g:aitrans_templates` and are plain dictionaries that describe how to build a prompt:

```lua
vim.g.aitrans_templates = {
  ["translate-to-ja"] = {
    title = "Translate to Japanese",
    desc = "Translate selected English text into natural Japanese",
    default_out = "scratch",
    default_provider = "openai",
    request_args_json = {
      reasoning = { effort = "minimal" },
      text = { verbosity = "medium" },
    },
    followup = { enabled = false },
    builder = function(ctx)
      local text = ctx.selection ~= "" and ctx.selection or ctx.selection_lines[1] or ""
      return {
        system = "You are a professional translator who outputs fluent Japanese.",
        prompt = string.format([[Please translate the following text into natural Japanese.

%s
]], text),
      }
    end,
  },
}
```

`ctx` contains metadata (buffer/file info, selection text/lines, byte diagnostics, etc.). Builder results are automatically `trim()`’d before sending, so trailing blank lines will not leak into the provider call.

Use `:echo aitrans#template#list()` to inspect registered templates or hot reload by reassigning `vim.g.aitrans_templates`.

---

## Usage

### Apply (replace/append/register/scratch)

```vim
" Replace the visual selection with a provider response
xnoremap <silent> <leader>ar :<C-u>call aitrans#apply({
      \ 'template': 'translate-to-ja',
      \ 'out': 'replace',
      \})<CR>
```

- `replace`: streamed text is buffered and applied once, giving a single undo step.
- `append`: the selection’s next line becomes the insertion point; an empty spacer line is removed automatically if nothing arrives.
- `register`: final text is written to `g:aitrans_register` (default `"` register).
- `scratch`: opens `aitrans-scratch.markdown` (split/float is controlled by `g:aitrans_scratch_split`) and streams chunks there.

### Compose

`aitrans#compose({ template = "foo" })` opens an editable buffer (float by default) with a metadata header:

```
# Aitrans Compose
- Template: foo
- Provider: openai
- Output: chat
- Model: gpt-5-mini
---
<editable prompt body>
```

- Normal `<CR>` submits; in float mode the window closes immediately, otherwise it stays for further edits.
- Visual selection fallback: if the builder returns an empty prompt, the selection is inserted as ```{filetype}``` fenced text.

### Chat

`aitrans#chat#open({ template = "foo" })` (or `aitrans#apply({ out = 'chat' })`) opens a right-side vertical split: response buffer on top, prompt buffer on bottom.

- Prompt buffer uses the same header as Compose; the line directly under `---` is always the send target. `<CR>` trims the region, sends it, logs it as `## You`, and clears the editable area.
- Response buffer keeps a running log in Markdown:
  ```
  # Aitrans Response

  ## You
  ...

  ## Assistant
  ...
  ```
  Streaming updates only touch the most recent `## Assistant` block; cursor focus never leaves the prompt window, while the response window auto-scrolls.
- Follow-up suggestions are **disabled by default**. A template must set `followup = { enabled = true }` (or you must pass `follow_up = true`) to show `[1]`–`[4]` shortcuts. No placeholder comments are emitted when disabled.
- Sessions auto-archive to Redux. Use:
  - `aitrans#chat#list()` → returns in-memory history (`[{id,template,provider,created_at,...}]`)
  - `aitrans#chat#resume({ 'id': '...' })` → rebuilds the split layout and replays `## You/Assistant` blocks
  - `aitrans#chat#save({ name = 'foo' })` / `aitrans#chat#load({ name = 'foo' })` → persist/restore Markdown + JSON logs in `g:aitrans_chat.log_dir`

---

## Follow-ups & Prompt Rules

- Prompt bodies and compose outputs are trimmed automatically; leading blank lines will not prevent submission.
- Append mode always inserts after the selection (never overwriting it) and removes any spacer line if no content was streamed.
- Follow-up UI renders only when explicitly enabled per template/opts, keeping the chat buffer clean for templates that don’t need it.

---

## Logging & Debugging

- Set `let g:aitrans_debug = v:true` to emit structured messages via `denops.log()`.
- Chat logs (`.md` + `.json`) are written to `g:aitrans_chat.log_dir`; you can build your own picker via `aitrans#chat#list_logs({ limit = 50 })`.
- There are no default user commands; integrate with your picker/UI by calling the exposed Vimscript functions.

---

## Development

```bash
deno test --allow-env --allow-read --allow-write --allow-net
```

Key TypeScript modules live under `denops/aitrans/`:

- `core/` – context building, provider execution, output sessions, logging
- `chat/` – UI controller, log persistence, Redux slice
- `compose/` – float/vsplit editor for prompt drafting
- `store/` – lightweight Redux setup (no Redux Toolkit)

Apply patches via `:deno task lint` / `deno fmt` as needed (future task). Pull requests should avoid Lua internals—Vimscript + TypeScript are the supported layers.
