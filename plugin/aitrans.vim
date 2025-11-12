if exists('g:loaded_aitrans')
  finish
endif

if !exists('*denops#plugin#load')
  finish
endif

let g:loaded_aitrans = 1

call denops#plugin#load('aitrans')
