import * as THREE from 'three';
import type { CubeFaceName, NormalizedFaceUV, ParsedCube } from '../parser/types';

/** Minecraft Bedrock uses 16 pixels per world block (meter) */
export const BEDROCK_UNIT_SCALE = 1 / 16;

/**
 * Three.js BoxGeometry face order:
 *   0: +X (east in local Bedrock->Three right-handed space)
 *   1: -X (west)
 *   2: +Y (up)
 *   3: -Y (down)
 *   4: +Z (south / back)
 *   5: -Z (north / front)
 */
const BOX_GEOMETRY_FACE_ORDER: readonly CubeFaceName[] = [
  'east',
  'west',
  'up',
  'down',
  'south',
  'north',
];

function applyFaceUV(
  uvAttr: THREE.BufferAttribute,
  faceIndex: number,
  faceUV: NormalizedFaceUV,
): void {
  const baseVertex = faceIndex * 4;

  // BoxGeometry per-face vertex order (looking at face from outside):
  //   0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right
  let corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [faceUV.u0, faceUV.v0],
    [faceUV.u1, faceUV.v0],
    [faceUV.u0, faceUV.v1],
    [faceUV.u1, faceUV.v1],
  ];

  // Optional per-face UV rotation (clockwise in texture space: 90 / 180 / 270 deg)
  const rot = ((faceUV.uvRotation ?? 0) % 360 + 360) % 360;
  if (rot === 90) {
    corners = [corners[2], corners[0], corners[3], corners[1]];
  } else if (rot === 180) {
    corners = [corners[3], corners[2], corners[1], corners[0]];
  } else if (rot === 270) {
    corners = [corners[1], corners[3], corners[0], corners[2]];
  }

  for (let i = 0; i < 4; i++) {
    uvAttr.setXY(baseVertex + i, corners[i][0], corners[i][1]);
  }
}

/**
 * Builds a single `THREE.BoxGeometry` for a parsed Bedrock cube.
 *
 * - Applies `inflate` bidirectionally via `cube.inflatedSize`
 * - Writes exact 24-vertex UVs for Box UV or Per-Face UV (with `flipY = false`)
 * - Collapses omitted Per-Face UV faces into degenerate triangles so they don't render
 */
export function buildCubeGeometry(
  cube: ParsedCube,
  unitScale = BEDROCK_UNIT_SCALE,
): THREE.BufferGeometry {
  if (cube.bakedFaces) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const face of cube.bakedFaces) {
      const base = positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const point = face.positions[i];
        positions.push(-(point[0] - cube.center[0]) * unitScale, (point[1] - cube.center[1]) * unitScale, (point[2] - cube.center[2]) * unitScale);
        normals.push(-face.normal[0], face.normal[1], face.normal[2]);
        uvs.push(face.uvs[i][0], face.uvs[i][1]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
  // Clamp tiny/zero-thickness planes (e.g. hair strands or capes) so BoxGeometry stays valid
  const w = Math.max(0.0001, Math.abs(cube.inflatedSize[0]) * unitScale);
  const h = Math.max(0.0001, Math.abs(cube.inflatedSize[1]) * unitScale);
  const d = Math.max(0.0001, Math.abs(cube.inflatedSize[2]) * unitScale);

  const geometry = new THREE.BoxGeometry(w, h, d);
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const faceName = BOX_GEOMETRY_FACE_ORDER[faceIdx];
    const faceUV = cube.uvs[faceName];

    if (faceUV.hidden) {
      // Collapse omitted per-face quads so they contribute zero fragments
      const base = faceIdx * 4;
      for (let v = 0; v < 4; v++) {
        posAttr.setXYZ(base + v, 0, 0, 0);
        uvAttr.setXY(base + v, 0, 0);
      }
    } else {
      applyFaceUV(uvAttr, faceIdx, faceUV);
    }
  }

  uvAttr.needsUpdate = true;
  posAttr.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
