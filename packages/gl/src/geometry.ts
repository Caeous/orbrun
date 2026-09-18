/**
 * The few generated geometries the renderer uses (the cursor's ring and
 * tile, a sprite's shadow disc and the doll's bars) and the polygon
 * triangulator behind the level's horizontal patches. Vertex order and uvs
 * are fixed: the baked crowd copies a shadow disc's attributes as they
 * are, so the arrays must come out the same as the baseline's.
 */
import { BufferGeometry, Float32BufferAttribute } from './core.js'
import earcut from './earcut.js'
import type { Vector2 } from './math.js'

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super()
    const width_half = width / 2
    const height_half = height / 2
    const gridX = Math.floor(widthSegments)
    const gridY = Math.floor(heightSegments)
    const gridX1 = gridX + 1
    const gridY1 = gridY + 1
    const segment_width = width / gridX
    const segment_height = height / gridY
    const indices: number[] = []
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segment_height - height_half
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segment_width - width_half
        vertices.push(x, -y, 0)
        normals.push(0, 0, 1)
        uvs.push(ix / gridX)
        uvs.push(1 - iy / gridY)
      }
    }
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = ix + gridX1 * iy
        const b = ix + gridX1 * (iy + 1)
        const c = ix + 1 + gridX1 * (iy + 1)
        const d = ix + 1 + gridX1 * iy
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }
    this.setIndex(indices)
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  }
}

export class CircleGeometry extends BufferGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super()
    segments = Math.max(3, segments)
    const indices: number[] = []
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    vertices.push(0, 0, 0)
    normals.push(0, 0, 1)
    uvs.push(0.5, 0.5)
    for (let s = 0, i = 3; s <= segments; s++, i += 3) {
      const segment = thetaStart + (s / segments) * thetaLength
      const vx = radius * Math.cos(segment)
      const vy = radius * Math.sin(segment)
      vertices.push(vx, vy, 0)
      normals.push(0, 0, 1)
      uvs.push((vertices[i] / radius + 1) / 2, (vertices[i + 1] / radius + 1) / 2)
    }
    for (let i = 1; i <= segments; i++) indices.push(i, i + 1, 0)
    this.setIndex(indices)
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  }
}

export class RingGeometry extends BufferGeometry {
  constructor(innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2) {
    super()
    thetaSegments = Math.max(3, thetaSegments)
    phiSegments = Math.max(1, phiSegments)
    const indices: number[] = []
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    let radius = innerRadius
    const radiusStep = (outerRadius - innerRadius) / phiSegments
    for (let j = 0; j <= phiSegments; j++) {
      for (let i = 0; i <= thetaSegments; i++) {
        const segment = thetaStart + (i / thetaSegments) * thetaLength
        const vx = radius * Math.cos(segment)
        const vy = radius * Math.sin(segment)
        vertices.push(vx, vy, 0)
        normals.push(0, 0, 1)
        uvs.push((vx / outerRadius + 1) / 2, (vy / outerRadius + 1) / 2)
      }
      radius += radiusStep
    }
    for (let j = 0; j < phiSegments; j++) {
      const thetaSegmentLevel = j * (thetaSegments + 1)
      for (let i = 0; i < thetaSegments; i++) {
        const segment = i + thetaSegmentLevel
        const a = segment
        const b = segment + thetaSegments + 1
        const c = segment + thetaSegments + 2
        const d = segment + 1
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }
    this.setIndex(indices)
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  }
}

/** Polygon helpers over 2D points: `triangulateShape` is ear clipping (earcut). */
export const ShapeUtils = {
  area(contour: Vector2[]): number {
    const n = contour.length
    let a = 0.0
    for (let p = n - 1, q = 0; q < n; p = q++) a += contour[p].x * contour[q].y - contour[q].x * contour[p].y
    return a * 0.5
  },
  isClockWise(pts: Vector2[]): boolean {
    return ShapeUtils.area(pts) < 0
  },
  /** Triangles of `contour` (with `holes` cut out) as index triples into the points as given, holes after the contour. */
  triangulateShape(contour: Vector2[], holes: Vector2[][]): number[][] {
    const vertices: number[] = []
    const holeIndices: number[] = []
    const faces: number[][] = []
    removeDupEndPts(contour)
    addContour(vertices, contour)
    let holeIndex = contour.length
    holes.forEach(removeDupEndPts)
    for (let i = 0; i < holes.length; i++) {
      holeIndices.push(holeIndex)
      holeIndex += holes[i].length
      addContour(vertices, holes[i])
    }
    const triangles = earcut(vertices, holeIndices)
    for (let i = 0; i < triangles.length; i += 3) faces.push(triangles.slice(i, i + 3))
    return faces
  },
}

function removeDupEndPts(points: Vector2[]) {
  const l = points.length
  if (l > 2 && points[l - 1].equals(points[0])) points.pop()
}

function addContour(vertices: number[], contour: Vector2[]) {
  for (let i = 0; i < contour.length; i++) vertices.push(contour[i].x, contour[i].y)
}
