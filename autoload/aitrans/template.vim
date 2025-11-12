let s:null = v:null

function! aitrans#template#list() abort
  let l:templates = get(g:, 'aitrans_templates', {})
  let l:ids = sort(keys(l:templates))
  let l:items = []
  for l:id in l:ids
    let l:item = s:to_metadata(l:id, l:templates[l:id])
    call add(l:items, l:item)
  endfor
  return l:items
endfunction

function! aitrans#template#get(id) abort
  if type(a:id) != v:t_string
    throw 'aitrans: template id must be a string'
  endif
  let l:templates = get(g:, 'aitrans_templates', {})
  if !has_key(l:templates, a:id)
    return v:null
  endif
  return s:to_metadata(a:id, l:templates[a:id])
endfunction

function! aitrans#template#resolve(id_or_table) abort
  if type(a:id_or_table) == v:t_string
    let l:templates = get(g:, 'aitrans_templates', {})
    if !has_key(l:templates, a:id_or_table)
      throw printf('aitrans: template "%s" was not found', a:id_or_table)
    endif
    let l:value = deepcopy(l:templates[a:id_or_table])
    let l:value.id = a:id_or_table
    return l:value
  endif

  if type(a:id_or_table) == v:t_dict
    return deepcopy(a:id_or_table)
  endif

  throw 'aitrans: invalid template reference'
endfunction

function! aitrans#template#execute(id_or_table, ctx, args) abort
  let l:def = aitrans#template#resolve(a:id_or_table)
  let l:Builder = get(l:def, 'builder', v:null)
  if type(l:Builder) != v:t_func
    throw 'aitrans: template does not have a builder'
  endif
  let l:ctx = type(a:ctx) == v:t_dict ? a:ctx : {}
  let l:args = type(a:args) == v:t_dict ? a:args : {}
  return call(l:Builder, [l:ctx, l:args])
endfunction

function! aitrans#template#run_callback(id, ctx) abort
  if type(a:id) != v:t_string
    return 0
  endif
  let l:def = aitrans#template#resolve(a:id)
  let l:Callback = get(l:def, 'on_complete', v:null)
  if type(l:Callback) != v:t_func
    return 0
  endif
  try
    call call(l:Callback, [deepcopy(a:ctx)])
    return 1
  catch /.*/
    call s:notify_callback_error(a:id, v:exception)
    return 0
  endtry
endfunction

function! s:to_metadata(id, value) abort
  if type(a:value) != v:t_dict
    return { 'id': a:id }
  endif
  let l:meta = deepcopy(a:value)
  let l:meta.id = a:id
  if has_key(l:meta, 'builder')
    call remove(l:meta, 'builder')
  endif
  return l:meta
endfunction

function! s:notify_callback_error(id, exception) abort
  if has('nvim')
    call luaeval('vim.notify(_A[1], vim.log.levels.WARN, { title = "aitrans" })', [printf('template "%s" on_complete failed: %s', a:id, a:exception)])
    return
  endif
  echohl WarningMsg
  echomsg printf('[aitrans] template "%s" on_complete failed: %s', a:id, a:exception)
  echohl None
endfunction
