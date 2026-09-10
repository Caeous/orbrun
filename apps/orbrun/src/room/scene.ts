import type { Camera, Scene } from '@orbrun/scene'
import { parseDes, vaultCamera, vaultScene, type TileNames, type Vault } from '@orbrun/vault'
import des from './antechamber.des?raw'

/**
 * The Antechamber (antechamber.des): the front end's one room, parsed once
 * and compiled against whatever tile set is at hand (the packed room atlas
 * in the app; the fixture gamedata in tests).
 */
let parsed: Vault | null = null

function antechamber(): Vault {
  return (parsed ??= parseDes(des))
}

export function antechamberScene(names: TileNames): { scene: Scene; camera: Camera } {
  const v = antechamber()
  return { scene: vaultScene(v, names), camera: vaultCamera(v) }
}
