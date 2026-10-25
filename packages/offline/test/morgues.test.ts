import { describe, expect, it } from 'vitest'
import { profileMorgues, readSaveFile } from '../src/index.js'

/**
 * IndexedDB as IDBFS leaves it (engine/wasm/pre.js): a database per save
 * directory, each file in `FILE_DATA` under its full path as { timestamp,
 * mode, contents }, the bytes MEMFS's own typed array.
 */
function idbfs(dbs: Record<string, Record<string, Uint8Array | Int8Array | null>>) {
  const opened: string[] = []
  const request = <T>(result: T) => {
    const req = { result } as { result: T; onsuccess?: () => void; onerror?: () => void }
    queueMicrotask(() => req.onsuccess?.())
    return req
  }
  const idb = {
    databases: async () => Object.keys(dbs).map((name) => ({ name })),
    open(name: string) {
      opened.push(name)
      const files = dbs[name] ?? {}
      const store = {
        getAllKeys: () => request(Object.keys(files)),
        get: (k: string) => request(k in files ? (files[k] ? { timestamp: new Date(), mode: 33206, contents: files[k] } : { timestamp: new Date(), mode: 16877 }) : undefined),
      }
      return request({ objectStoreNames: { contains: (n: string) => n === 'FILE_DATA' }, transaction: () => ({ objectStore: () => store }), close() {} })
    },
  } as unknown as IDBFactory
  return { idb, opened }
}

const text = (t: string) => new Int8Array(new TextEncoder().encode(t).buffer)

describe("a profile's morgues on this device", () => {
  const { idb, opened } = idbfs({
    '/crawl-0.34~sam': {
      '/crawl-0.34~sam/morgue': null,
      '/crawl-0.34~sam/morgue/morgue-sam-20261025-160832.txt': text('0 sam the Shield-Bearer'),
      '/crawl-0.34~sam/morgue/morgue-sam-20261025-160832.lst': text(''),
      '/crawl-0.34~sam/saves/sam.cs': text('save'),
    },
    '/crawl-trunk~sam': { '/crawl-trunk~sam/morgue/morgue-sam-20261024-101010.txt': text('12 sam the Slasher') },
    '/crawl-0.34~samuel': { '/crawl-0.34~samuel/morgue/morgue-samuel-20261024-101010.txt': text('x') },
    '/crawl-0.34': { '/crawl-0.34/morgue/morgue-Player-20261024-101010.txt': text('x') },
  })

  it('finds them in every slot it played in, and no one else’s', async () => {
    expect(await profileMorgues('Sam', idb)).toEqual([
      { db: '/crawl-0.34~sam', path: '/crawl-0.34~sam/morgue/morgue-sam-20261025-160832.txt' },
      { db: '/crawl-trunk~sam', path: '/crawl-trunk~sam/morgue/morgue-sam-20261024-101010.txt' },
    ])
    expect(await profileMorgues('Player', idb)).toEqual([{ db: '/crawl-0.34', path: '/crawl-0.34/morgue/morgue-Player-20261024-101010.txt' }])
  })

  it('reads one as text, whatever typed array holds its bytes', async () => {
    expect(await readSaveFile('/crawl-0.34~sam', '/crawl-0.34~sam/morgue/morgue-sam-20261025-160832.txt', idb)).toBe('0 sam the Shield-Bearer')
    // a directory has no contents, and a file that is not there is nothing
    expect(await readSaveFile('/crawl-0.34~sam', '/crawl-0.34~sam/morgue', idb)).toBeNull()
    expect(await readSaveFile('/crawl-0.34~sam', '/crawl-0.34~sam/morgue/nope.txt', idb)).toBeNull()
  })

  it('never opens a database that is not there, which would make it', async () => {
    opened.length = 0
    expect(await readSaveFile('/crawl-0.35~sam', '/crawl-0.35~sam/morgue/x.txt', idb)).toBeNull()
    expect(opened).toEqual([])
  })
})
