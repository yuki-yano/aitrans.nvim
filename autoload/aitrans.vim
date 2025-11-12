function! aitrans#apply(opts) range abort
  call s:ensure_denops()
  if type(a:opts) != v:t_dict
    throw 'aitrans: opts must be a Dictionary'
  endif
  if has_key(a:opts, 'builder') && type(a:opts.builder) == v:t_func
    throw 'aitrans: builder funcref is not supported; register template instead'
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

  return denops#request('aitrans', 'apply', [l:opts])
endfunction

function! aitrans#stop(...) abort
  if !exists('*denops#request')
    return v:false
  endif
  let l:id = a:0 > 0 ? a:1 : v:null
  if type(l:id) != v:t_string || empty(l:id)
    return v:false
  endif
  try
    call denops#request('aitrans', 'stopJob', [{ 'id': l:id }])
    return v:true
  catch /.*/
    return v:false
  endtry
endfunction

function! aitrans#compose(opts) range abort
  if type(a:opts) != v:t_dict
    throw 'aitrans: compose opts must be a Dictionary'
  endif
  call s:ensure_denops()
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

function! s:ensure_denops() abort
  if !exists('*denops#request')
    throw 'aitrans: Denops is not available'
  endif
  if exists('*denops#plugin#load')
    call denops#plugin#load('aitrans', {})
  endif
endfunction
