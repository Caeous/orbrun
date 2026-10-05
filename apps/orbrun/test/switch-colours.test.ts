// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { switchColours } from '../src/overlays'

describe('a switch’s touch button wears the footer’s colours', () => {
  it('the key as the line draws it, the words with their lit half bright, a | where a caption may break', () => {
    // the skills screen's line as the server sends it (tileweb-text.cc spans)
    const line = document.createElement('div')
    line.innerHTML = "<span class='fg7'>[</span><span class='fg14'>/</span><span class='fg7'>] </span><span class='fg8'>auto</span><span class='fg7'>|</span><span class='fg15'>manual</span><span class='fg7'> mode</span>"
    expect(switchColours(line, 0, line.textContent!.length, '/')).toEqual({
      keyHtml: '<span class="fg7">[</span><span class="fg14">/</span><span class="fg7">]</span>',
      wordHtml: '<span class="fg8">auto</span><span class="fg7">|<wbr></span><span class="fg15">manual</span><span class="fg7"> mode</span>',
    })
  })
  it('a switch in the middle of a line, its full stop left to the sentence', () => {
    const line = document.createElement('div')
    line.innerHTML = "<span class='fg7'>xx [<span class='fg15'>?</span>] toggle description.</span>"
    const start = line.textContent!.indexOf('[')
    expect(switchColours(line, start, line.textContent!.length, '?')).toEqual({
      keyHtml: '<span class="fg7">[</span><span class="fg15">?</span><span class="fg7">]</span>',
      wordHtml: '<span class="fg7">toggle description</span>',
    })
  })
})
