// Where the terminal game keeps its saves, settings and SSH host key: ~/.cache/orbrun, moved there from
// ~/.cache/orbrun-term, where it was before the game was `orbrun`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function stateDir() {
  const dir = path.join(os.homedir(), '.cache', 'orbrun')
  const old = path.join(os.homedir(), '.cache', 'orbrun-term')
  if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir)
  return dir
}
