if exists('g:loaded_aitrans')
  finish
endif

if !exists('*denops#plugin#load')
  finish
endif

let g:loaded_aitrans = 1

call denops#plugin#load('aitrans')

augroup aitrans
  autocmd!
  autocmd User DenopsPluginPost:aitrans call aitrans#config#sync()
augroup END

command! AitransReloadConfig call aitrans#config#sync()
