function! aitrans#chat#close() abort
  call s:notify('chatClose', {})
endfunction

function! aitrans#chat#submit() abort
  call s:notify('chatSubmit', {})
endfunction

function! aitrans#chat#apply_followup(index) abort
  call s:notify('chatApplyFollowUp', { 'index': a:index })
endfunction

function! aitrans#chat#save(...) abort
  call s:notify('chatSave', a:0 > 0 ? a:1 : v:null)
endfunction

function! aitrans#chat#load(name) abort
  call s:notify('chatLoad', a:name)
endfunction

function! aitrans#chat#list_logs(...) abort
  call s:notify('chatListLogs', a:0 > 0 ? a:1 : {})
endfunction

function! aitrans#chat#list(...) abort
  if !exists('*denops#request')
    return []
  endif
  try
    return denops#request('aitrans', 'chatListSessions', [a:0 > 0 ? a:1 : {}])
  catch /.*/
    echohl WarningMsg
    echomsg '[aitrans] ' . v:exception
    echohl None
    return []
  endtry
endfunction

function! aitrans#chat#resume(...) abort
  call s:notify('chatResume', a:0 > 0 ? a:1 : {})
endfunction

function! s:notify(method, payload) abort
  if !exists('*denops#notify')
    echohl WarningMsg
    echomsg '[aitrans] Denops is not available'
    echohl None
    return
  endif
  if exists('*denops#plugin#load')
    call denops#plugin#load('aitrans', {})
  endif
  try
    call denops#notify('aitrans', a:method, [a:payload])
  catch /.*/
    echohl WarningMsg
    echomsg '[aitrans] ' . v:exception
    echohl None
  endtry
endfunction
