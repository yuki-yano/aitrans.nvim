function! aitrans#chat#close() abort
  call aitrans#notify('chatClose', [{}])
endfunction

function! aitrans#chat#submit() abort
  call aitrans#notify('chatSubmit', [{}])
endfunction

function! aitrans#chat#apply_followup(index) abort
  call aitrans#notify('chatApplyFollowUp', [{ 'index': a:index }])
endfunction

function! aitrans#chat#save(...) abort
  call aitrans#notify('chatSave', [a:0 > 0 ? a:1 : v:null])
endfunction

function! aitrans#chat#load(name) abort
  call aitrans#notify('chatLoad', [a:name])
endfunction

function! aitrans#chat#list_logs(...) abort
  call aitrans#notify('chatListLogs', [a:0 > 0 ? a:1 : {}])
endfunction

function! aitrans#chat#list(...) abort
  try
    return aitrans#request('chatListSessions', [a:0 > 0 ? a:1 : {}])
  catch /.*/
    echohl WarningMsg
    echomsg '[aitrans] ' . v:exception
    echohl None
    return []
  endtry
endfunction

function! aitrans#chat#resume(...) abort
  call aitrans#notify('chatResume', [a:0 > 0 ? a:1 : {}])
endfunction
