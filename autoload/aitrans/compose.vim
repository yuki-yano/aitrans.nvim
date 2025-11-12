function! aitrans#compose#open(opts) abort
  call s:ensure_denops()
  let l:opts = type(a:opts) == v:t_dict ? deepcopy(a:opts) : {}
  call s:add_range(l:opts)
  call s:inject_selection(l:opts)
  return denops#request('aitrans', 'composeOpen', [l:opts])
endfunction

function! aitrans#compose#close() abort
  if !exists('*denops#notify')
    return
  endif
  call denops#notify('aitrans', 'composeClose', [{}])
endfunction

function! s:add_range(opts) abort
  if has_key(a:opts, 'range')
    return
  endif
  if get(a:opts, 'source', '') ==# 'none'
    return
  endif
  if mode() =~# 'v'
    let l:start = line("'<")
    let l:end = line("'>")
    if l:start > 0 && l:end >= l:start
      let a:opts.range = [l:start, l:end]
      let a:opts.source_bufnr = bufnr('%')
    endif
  endif
endfunction

function! s:inject_selection(opts) abort
  if has_key(a:opts, 'selection')
    return
  endif
  if get(a:opts, 'source', '') ==# 'none'
    return
  endif
  if has_key(a:opts, 'range')
    let l:start = a:opts.range[0]
    let l:end = a:opts.range[1]
    if l:start > 0 && l:end >= l:start
      let a:opts.selection = join(getline(l:start, l:end), "\n")
    endif
  endif
endfunction

function! s:ensure_denops() abort
  if !exists('*denops#request')
    throw 'aitrans: Denops is not available'
  endif
  if exists('*denops#plugin#load')
    call denops#plugin#load('aitrans', {})
  endif
endfunction
