let s:null = v:null

function! aitrans#config#sync() abort
  if !exists('*denops#notify')
    return v:false
  endif

  if exists('*denops#plugin#load')
    call denops#plugin#load('aitrans', {})
  endif

  let l:payload = aitrans#config#collect()
  try
    call denops#notify('aitrans', 'updateConfig', [l:payload])
    return v:true
  catch /.*/
    call s:notify_error('aitrans: updateConfig failed: ' . v:exception)
    return v:false
  endtry
endfunction

function! aitrans#config#collect() abort
  let l:config = {
        \ 'globals': s:collect_globals(),
        \ 'chat': s:deepcopy(get(g:, 'aitrans_chat', {})),
        \ 'compose': s:deepcopy(get(g:, 'aitrans_compose', {})),
        \ 'providers': s:collect_providers(),
        \ 'templates': aitrans#template#list(),
        \ 'timestamp': reltimefloat(reltime()),
        \ }
  return l:config
endfunction

function! s:collect_globals() abort
  let l:keys = [
        \ ['progress_ui', 'aitrans_progress_ui'],
        \ ['progress_interval_ms', 'aitrans_progress_interval_ms'],
        \ ['timeout_ms', 'aitrans_timeout_ms'],
        \ ['debug', 'aitrans_debug'],
        \ ['register', 'aitrans_register'],
        \ ['scratch_split', 'aitrans_scratch_split'],
        \ ['max_input_bytes', 'aitrans_max_input_bytes'],
        \ ]
  let l:out = {}
  for l:item in l:keys
    let l:value = s:get_g(l:item[1], s:null)
    if l:value isnot# s:null
      let l:out[l:item[0]] = l:value
    endif
  endfor
  return l:out
endfunction

function! s:collect_providers() abort
  let l:providers = {}
  for [l:name, l:def] in items(get(g:, 'aitrans_providers', {}))
    if type(l:name) != v:t_string
      continue
    endif
    if type(l:def) == v:t_dict
      let l:providers[l:name] = s:deepcopy(l:def)
    else
      let l:providers[l:name] = {}
    endif
  endfor
  return l:providers
endfunction

function! s:get_g(name, default) abort
  if has_key(g:, a:name)
    return deepcopy(get(g:, a:name))
  endif
  return a:default
endfunction

function! s:deepcopy(value) abort
  return deepcopy(a:value)
endfunction

function! s:notify_error(message) abort
  if has('nvim')
    call luaeval('vim.notify(_A[1], vim.log.levels.ERROR, { title = "aitrans" })', [a:message])
    return
  endif
  echohl ErrorMsg
  echomsg a:message
  echohl None
endfunction
