import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'

/**
 * The depth pass renders the scene into the very texture the ghost shaders
 * sample, so the ghosts themselves must be out of it: a draw that reads the
 * image it writes is a framebuffer feedback loop, which GL refuses.
 */
describe('ghost depth pass', () => {
  it('hides the ghost sprites while the depth image is drawn, and puts them back', () => {
    const r = new Render3d() as unknown as {
      billboardGroup: THREE.Group
      renderOccluderDepth(r: unknown): void
    }
    const ghost = new THREE.Object3D()
    ghost.userData.kind = 'ghost'
    const sprite = new THREE.Object3D()
    sprite.userData.kind = 'monster'
    const hidden = new THREE.Object3D()
    hidden.userData.kind = 'ghost'
    hidden.visible = false
    r.billboardGroup.add(ghost, sprite, hidden)

    const seen: { ghost: boolean; sprite: boolean; hidden: boolean }[] = []
    let target: unknown = 'frame'
    const fake = {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => void (target = t),
      clear: () => {},
      render: () => void seen.push({ ghost: ghost.visible, sprite: sprite.visible, hidden: hidden.visible }),
    }
    r.renderOccluderDepth(fake)

    expect(seen).toEqual([{ ghost: false, sprite: true, hidden: false }])
    // and the frame's own pass finds them as it left them
    expect([ghost.visible, sprite.visible, hidden.visible]).toEqual([true, true, false])
    expect(target).toBe('frame')
  })
})
