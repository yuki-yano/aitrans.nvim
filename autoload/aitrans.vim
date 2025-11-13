function! aitrans#apply(opts) range abort
  if type(a:opts) != v:t_dict
    throw 'aitrans: opts must be a Dictionary'
  endif
  if has_key(a:opts, 'builder') && type(a:opts.builder) == v:t_func
    throw 'aitrans: builder funcref is not supported; register template instead'
  endif
  let l:opts = deepcopy(a:opts)

  if exists('a:firstline') && exists('a:lastline') && s:should_add_range(l:opts)
    if a:firstline > 0 && a:lastline >= a:firstline && !has_key(l:opts, 'range')
      let l:opts.range = [a:firstline, a:lastline]
      if !has_key(l:opts, 'source')
        let l:opts.source = a:firstline == a:lastline ? 'line' : 'selection'
      endif
    endif
  endif

  return aitrans#request('apply', [l:opts])
endfunction

function! aitrans#stop(...) abort
  let l:id = a:0 > 0 ? a:1 : v:null
  if type(l:id) != v:t_string || empty(l:id)
    return v:false
  endif
  try
    call aitrans#request('stopJob', [{ 'id': l:id }])
    return v:true
  catch /.*/
    return v:false
  endtry
endfunction

function! aitrans#compose(opts) range abort
  if type(a:opts) != v:t_dict
    throw 'aitrans: compose opts must be a Dictionary'
  endif
  let l:opts = deepcopy(a:opts)
  if exists('a:firstline') && exists('a:lastline')
    if a:firstline > 0 && a:lastline >= a:firstline && !has_key(l:opts, 'range')
      let l:opts.range = [a:firstline, a:lastline]
      if !has_key(l:opts, 'source')
        let l:opts.source = a:firstline == a:lastline ? 'line' : 'selection'
      endif
    endif
  endif
  return aitrans#compose#open(l:opts)
endfunction

function! s:should_add_range(opts) abort
  return get(a:opts, 'source', '') !=# 'none'
endfunction

function! aitrans#request(method, args) abort
  call s:ensure_plugin_ready()
  return denops#request('aitrans', a:method, a:args)
endfunction

function! aitrans#notify(method, args) abort
  call s:ensure_plugin_ready()
  call denops#notify('aitrans', a:method, a:args)
endfunction

function! s:ensure_plugin_ready() abort
  if !exists('*denops#plugin#wait')
    throw 'aitrans: Denops is not available'
  endif
  if exists('*denops#plugin#load')
    call denops#plugin#load('aitrans', {})
  endif
  try
    call denops#plugin#wait('aitrans', { 'timeout': 1000 })
  catch /denops: timeout/
    throw 'aitrans: Plugin load timeout'
  catch /.*/
  endtry
endfunction
