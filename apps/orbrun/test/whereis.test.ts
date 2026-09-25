import { describe, it, expect } from 'vitest'
import { morgueDirGuesses, morgueDirOf, parseWhereis, parseXlog, saveWaiting, whereisUrl, whereisVersion } from '../src/whereis'
import { describeCharacter, describePlace, findServer } from '../src/servers'

const cdi = findServer('cdi')!

/** The real file crawl.dcss.io published for the test account on 2026-09-12, a trunk game saved mid-dungeon. */
const SAVED =
  'v=0.35-a0:vlong=0.35-a0-1015-gbe08bfc2e8:lv=0.1:vsavrv=Git::0.35-a0-1015-gbe08bfc2e8:vsav=34.339:tiles=1:' +
  'name=orbrun:race=Minotaur:cls=Fighter:char=MiFi:xl=3:sk=Armour:sklev=4:title=Covered:place=D::2:br=D:lvl=2:' +
  'absdepth=2:hp=30:mhp=33:mmhp=33:mp=2:mmp=2:bmmp=2:str=22:int=5:dex=9:ac=7:ev=13:sh=4:start=20260813013806S:' +
  'dur=616:turn=1084:aut=10976:kills=32:gold=78:goldfound=78:goldspent=0:scrollsused=0:potionsused=0:' +
  'time=20260813020600S:status=saved\n'

describe('parseXlog', () => {
  it('reads a doubled colon as the colon it stands for, so a place arrives whole', () => {
    // hiscores.cc xlog_fields::xlog_line escapes a colon in a value by doubling it: place=D::2 is "D:2"
    expect(parseXlog('name=orbrun:place=D::2:status=saved')).toEqual({ name: 'orbrun', place: 'D:2', status: 'saved' })
    expect(parseXlog('a=1:b=:c=x')).toEqual({ a: '1', b: '', c: 'x' })
  })
})

describe('whereisVersion', () => {
  it('puts a build on the row it belongs to', () => {
    // an alpha marker is trunk; a release is its major and minor, as gameLinkRows groups them
    expect(whereisVersion('0.35-a0-1015-gbe08bfc2e8')).toBe('trunk')
    expect(whereisVersion('0.35-a0')).toBe('trunk')
    expect(whereisVersion('0.34.1-4-g0e95e087e2')).toBe('0.34')
    expect(whereisVersion('0.34.1')).toBe('0.34')
    expect(whereisVersion('nonsense')).toBeNull()
  })
})

describe('parseWhereis', () => {
  it('reads the file the server publishes, as the home screen speaks it', () => {
    const w = parseWhereis(SAVED)!
    expect(w.version).toBe('trunk')
    expect(w.status).toBe('saved')
    expect(saveWaiting(w)).toBe(true)
    expect(describeCharacter(w.character)).toBe('orbrun the Covered, Minotaur Fighter XL3')
    expect(describePlace(w.character)).toBe('D:2')
  })

  it('counts only crawl’s own word for a save as one', () => {
    // files.cc save_game writes "saved" and end.cc game_exit::save writes "save"; every other status is an
    // ending (dead, won, quit, bailed out) or nobody's word either way (crash, abort), and neither is a yes
    for (const status of ['saved', 'save']) expect(saveWaiting(parseWhereis(SAVED.replace('status=saved', 'status=' + status))!)).toBe(true)
    for (const status of ['dead', 'won', 'quit', 'bailed out', 'crash', 'abort', 'unknown']) {
      const w = parseWhereis(SAVED.replace('status=saved', 'status=' + status))!
      expect(w.status, status).toBe(status)
      expect(saveWaiting(w), status).toBe(false)
    }
  })

  it('is null for anything that is not one: an error page, an empty file, a line without a character', () => {
    expect(parseWhereis('')).toBeNull()
    expect(parseWhereis('<html><body>404 Not Found</body></html>')).toBeNull()
    expect(parseWhereis('v=0.34.1:status=saved')).toBeNull()
  })
})

describe('morgue directories', () => {
  it('takes the directory from the dump the server handed back', () => {
    expect(morgueDirOf(cdi, '/crawl/morgue/orbrun/morgue-orbrun-20260910-120000')).toBe('/crawl/morgue/orbrun/')
    expect(morgueDirOf(cdi, 'https://crawl.dcss.io/crawl/morgue/orbrun/orbrun')).toBe('/crawl/morgue/orbrun/')
    // never off the server the account belongs to
    expect(morgueDirOf(cdi, 'https://example.com/morgue/orbrun/x')).toBeNull()
  })

  it('guesses the layouts dgamelaunch-config ships with, CDI’s first', () => {
    expect(morgueDirGuesses('orbrun')).toEqual(['/crawl/morgue/orbrun/', '/morgue/orbrun/', '/rawdata/orbrun/'])
  })

  it('names the file after the directory, so the server’s own spelling of the account is kept', () => {
    expect(whereisUrl(cdi, '/crawl/morgue/orbrun/')).toBe('/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/orbrun.where')
    expect(whereisUrl(cdi, '/rawdata/Dwarfsong/')).toBe('/morgue-proxy/crawl.dcss.io/rawdata/Dwarfsong/Dwarfsong.where')
    expect(whereisUrl(cdi, '/')).toBeNull()
  })
})
