import * as THREE from 'three';
import type { ParsedBone, ParsedModel, Vec3 } from '../parser/types';
import type { BonePoseDelta } from '../animation/AnimationController';
import { BEDROCK_UNIT_SCALE, buildCubeGeometry } from './CubeGeometryBuilder';
import type { ManagedMaterialTable } from './TextureManager';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Converts a Bedrock model-space point `[x, y, z]` into Three.js local right-handed space
 * (prior to the root 180° Y rotation that turns -Z North into +Z facing the camera).
 */
export function bedrockPointToThree(pt: Vec3, scale = BEDROCK_UNIT_SCALE): [number, number, number] {
  return [-pt[0] * scale, pt[1] * scale, pt[2] * scale];
}

/**
 * Writes a Bedrock Euler rotation `[rx, ry, rz]` (degrees, intrinsic ZYX order)
 * into a reusable `THREE.Euler` instance.
 */
export function setBedrockEulerDegrees(
  target: THREE.Euler,
  rxDeg: number,
  ryDeg: number,
  rzDeg: number,
): void {
  target.set(-rxDeg * DEG_TO_RAD, -ryDeg * DEG_TO_RAD, rzDeg * DEG_TO_RAD, 'ZYX');
}

export interface BoneRigNode {
  name: string;
  parsed: ParsedBone;
  /** Positioned at T(pivot); receives bone rotation R and animation position/scale */
  pivotGroup: THREE.Group;
  /** Child of pivotGroup positioned at T(-pivot); holds cubes and child bones */
  offsetGroup: THREE.Group;
  /** Pre-converted bind pivot in Three.js local space */
  bindPivotThree: [number, number, number];
  /** Bind rotation in Bedrock degrees */
  bindRotationDeg: Vec3;
}

export interface SkeletonDebugResources {
  group: THREE.Group;
  setVisible: (visible: boolean) => void;
  setShowPivots: (show: boolean) => void;
  setShowBounds: (show: boolean) => void;
  updateBoneLinks: () => void;
  dispose: () => void;
}

export interface BuiltRig {
  /** Top-level root group rotated 180° around Y so the character faces +Z */
  root: THREE.Group;
  /** Map of all constructed rigid bone nodes by bone name */
  bones: Map<string, BoneRigNode>;
  /** Debug overlay group (bone pivots, hierarchy lines, cube bounding boxes) */
  debug: SkeletonDebugResources;
  /** Applies per-frame additive animation deltas to the rig (zero allocations) */
  applyPose: (deltas: ReadonlyMap<string, BonePoseDelta>) => void;
  /** Resets all bones back to their static bind pose */
  resetBindPose: () => void;
  /** Disposes every geometry, material, texture, and debug helper owned by this rig */
  dispose: () => void;
  /** Number of geometries owned by this rig (excluding debug helpers when hidden) */
  readonly geometryCount: number;
  /** Number of materials owned by this rig */
  readonly materialCount: number;
  /** Number of textures owned by this rig */
  readonly textureCount: number;
}

function selectCubeMaterial(
  table: ManagedMaterialTable,
  materialKey: string | undefined,
  textureIndex: number,
): THREE.MeshStandardMaterial {
  if (materialKey) {
    const byName = table.byKey.get(materialKey) ?? table.byKey.get(materialKey.toLowerCase());
    if (byName) return byName;
  }
  if (textureIndex >= 0 && textureIndex < table.byIndex.length) {
    return table.byIndex[textureIndex];
  }
  return table.defaultMaterial;
}

/**
 * Builds a rigid `THREE.Group` bone hierarchy (NO `SkinnedMesh`) from a `ParsedModel`
 * and `ManagedMaterialTable`.
 *
 * Hierarchy per bone:
 *   pivotGroup (position = +pivot, rotation = R, scale = S)
 *     └─ offsetGroup (position = -pivot)
 *          ├─ cube meshes (placed at bedrock center)
 *          └─ childBone.pivotGroup
 *
 * This guarantees every bone rotates strictly around its pivot via `T(pivot) · R · T(-pivot)`.
 */
export function buildModelRig(
  model: ParsedModel,
  materials: ManagedMaterialTable,
  unitScale = BEDROCK_UNIT_SCALE,
): BuiltRig {
  const root = new THREE.Group();
  root.name = `ysm:${model.description.identifier}`;
  // Bedrock models face -Z (North); rotate 180° around +Y so model faces +Z in Three.js
  root.rotation.y = Math.PI;

  const bones = new Map<string, BoneRigNode>();
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const debugGeometries: THREE.BufferGeometry[] = [];
  const debugMaterials: THREE.Material[] = [];

  // Create debug containers (toggled on demand, lazily populated or lightweight)
  const debugGroup = new THREE.Group();
  debugGroup.name = 'ysm:debug';
  debugGroup.visible = false;

  const pivotMarkersGroup = new THREE.Group();
  pivotMarkersGroup.name = 'ysm:debug:pivots';
  const boundsGroup = new THREE.Group();
  boundsGroup.name = 'ysm:debug:bounds';
  debugGroup.add(pivotMarkersGroup);
  debugGroup.add(boundsGroup);

  // Shared debug geometries & materials (minimizes GPU memory footprint)
  const pivotSphereGeo = new THREE.SphereGeometry(0.022, 8, 6);
  const pivotSphereMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    depthTest: false,
    transparent: true,
    opacity: 0.92,
  });
  const axisLineMatX = new THREE.LineBasicMaterial({ color: 0xef4444, depthTest: false });
  const axisLineMatY = new THREE.LineBasicMaterial({ color: 0x22c55e, depthTest: false });
  const axisLineMatZ = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false });
  const axisGeoX = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.09, 0, 0),
  ]);
  const axisGeoY = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.09, 0),
  ]);
  const axisGeoZ = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0.09),
  ]);
  const cubeEdgeMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.55,
  });
  const boneLinkMat = new THREE.LineBasicMaterial({
    color: 0xfbbf24,
    depthTest: false,
    transparent: true,
    opacity: 0.75,
  });

  debugGeometries.push(pivotSphereGeo, axisGeoX, axisGeoY, axisGeoZ);
  debugMaterials.push(
    pivotSphereMat,
    axisLineMatX,
    axisLineMatY,
    axisLineMatZ,
    cubeEdgeMat,
    boneLinkMat,
  );

  // Per-bone debug attachments (live inside bone hierarchy so they follow animation automatically)
  const boneDebugGizmos: THREE.Object3D[] = [];
  const cubeDebugWireframes: THREE.Object3D[] = [];

  for (const parsedBone of model.bones) {
    const pivotThree = bedrockPointToThree(parsedBone.pivot, unitScale);

    const pivotGroup = new THREE.Group();
    pivotGroup.name = parsedBone.name;
    pivotGroup.position.set(pivotThree[0], pivotThree[1], pivotThree[2]);
    setBedrockEulerDegrees(
      pivotGroup.rotation,
      parsedBone.rotation[0],
      parsedBone.rotation[1],
      parsedBone.rotation[2],
    );

    const offsetGroup = new THREE.Group();
    offsetGroup.name = `${parsedBone.name}__offset`;
    offsetGroup.position.set(-pivotThree[0], -pivotThree[1], -pivotThree[2]);
    pivotGroup.add(offsetGroup);

    // Attach bone pivot gizmo directly on pivotGroup (follows bone animation automatically)
    const gizmo = new THREE.Group();
    gizmo.visible = false;
    const dot = new THREE.Mesh(pivotSphereGeo, pivotSphereMat);
    dot.renderOrder = 999;
    const lx = new THREE.Line(axisGeoX, axisLineMatX);
    const ly = new THREE.Line(axisGeoY, axisLineMatY);
    const lz = new THREE.Line(axisGeoZ, axisLineMatZ);
    lx.renderOrder = ly.renderOrder = lz.renderOrder = 999;
    gizmo.add(dot, lx, ly, lz);
    pivotGroup.add(gizmo);
    boneDebugGizmos.push(gizmo);

    // Build cubes attached rigidly to offsetGroup
    for (let cIdx = 0; cIdx < parsedBone.cubes.length; cIdx++) {
      const cube = parsedBone.cubes[cIdx];
      const geometry = buildCubeGeometry(cube, unitScale);
      ownedGeometries.push(geometry);

      const mat = selectCubeMaterial(materials, cube.materialKey, cube.textureIndex);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = `${parsedBone.name}_cube_${cIdx}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const cubeCenterThree = bedrockPointToThree(cube.center, unitScale);

      // Debug bounding wireframe attached directly to cube mesh
      const edgeGeo = new THREE.EdgesGeometry(geometry);
      debugGeometries.push(edgeGeo);
      const wireframe = new THREE.LineSegments(edgeGeo, cubeEdgeMat);
      wireframe.visible = false;
      mesh.add(wireframe);
      cubeDebugWireframes.push(wireframe);

      if (
        cube.rotation &&
        (cube.rotation[0] !== 0 || cube.rotation[1] !== 0 || cube.rotation[2] !== 0)
      ) {
        // Cube-local pivot rotation: T(cubePivot) · R_cube · T(-cubePivot)
        const cPivotThree = bedrockPointToThree(cube.pivot ?? cube.center, unitScale);
        const cubePivotGroup = new THREE.Group();
        cubePivotGroup.position.set(cPivotThree[0], cPivotThree[1], cPivotThree[2]);
        setBedrockEulerDegrees(
          cubePivotGroup.rotation,
          cube.rotation[0],
          cube.rotation[1],
          cube.rotation[2],
        );
        mesh.position.set(
          cubeCenterThree[0] - cPivotThree[0],
          cubeCenterThree[1] - cPivotThree[1],
          cubeCenterThree[2] - cPivotThree[2],
        );
        cubePivotGroup.add(mesh);
        offsetGroup.add(cubePivotGroup);
      } else {
        mesh.position.set(cubeCenterThree[0], cubeCenterThree[1], cubeCenterThree[2]);
        offsetGroup.add(mesh);
      }
    }

    const node: BoneRigNode = {
      name: parsedBone.name,
      parsed: parsedBone,
      pivotGroup,
      offsetGroup,
      bindPivotThree: pivotThree,
      bindRotationDeg: [parsedBone.rotation[0], parsedBone.rotation[1], parsedBone.rotation[2]],
    };
    bones.set(parsedBone.name, node);

    // Mount into parent bone's offsetGroup or model root
    if (parsedBone.parent && bones.has(parsedBone.parent)) {
      bones.get(parsedBone.parent)!.offsetGroup.add(pivotGroup);
    } else {
      root.add(pivotGroup);
    }
  }

  // Build dynamic parent-to-child bone link lines in model-root space
  const linkPairs: [BoneRigNode, BoneRigNode][] = [];
  for (const node of bones.values()) {
    if (node.parsed.parent && bones.has(node.parsed.parent)) {
      linkPairs.push([bones.get(node.parsed.parent)!, node]);
    }
  }
  const linkPositions = new Float32Array(Math.max(1, linkPairs.length) * 2 * 3);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
  debugGeometries.push(linkGeo);
  const linkLines = new THREE.LineSegments(linkGeo, boneLinkMat);
  linkLines.frustumCulled = false;
  linkLines.renderOrder = 998;
  pivotMarkersGroup.add(linkLines);
  root.add(debugGroup);

  // Reusable scratch vectors for bone link updates (zero per-frame GC)
  const _invRoot = new THREE.Matrix4();
  const _wParent = new THREE.Vector3();
  const _wChild = new THREE.Vector3();

  let debugVisible = false;
  let showPivots = true;
  let showBounds = true;

  const syncDebugVisibility = (): void => {
    debugGroup.visible = debugVisible;
    const pivotsOn = debugVisible && showPivots;
    const boundsOn = debugVisible && showBounds;
    pivotMarkersGroup.visible = pivotsOn;
    for (let i = 0; i < boneDebugGizmos.length; i++) {
      boneDebugGizmos[i].visible = pivotsOn;
    }
    for (let i = 0; i < cubeDebugWireframes.length; i++) {
      cubeDebugWireframes[i].visible = boundsOn;
    }
  };

  const updateBoneLinks = (): void => {
    if (!debugVisible || !showPivots || linkPairs.length === 0) return;
    root.updateWorldMatrix(true, true);
    _invRoot.copy(root.matrixWorld).invert();
    const posAttr = linkGeo.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < linkPairs.length; i++) {
      const [parentNode, childNode] = linkPairs[i];
      parentNode.pivotGroup.getWorldPosition(_wParent).applyMatrix4(_invRoot);
      childNode.pivotGroup.getWorldPosition(_wChild).applyMatrix4(_invRoot);
      posAttr.setXYZ(i * 2, _wParent.x, _wParent.y, _wParent.z);
      posAttr.setXYZ(i * 2 + 1, _wChild.x, _wChild.y, _wChild.z);
    }
    posAttr.needsUpdate = true;
  };

  const applyPose = (deltas: ReadonlyMap<string, BonePoseDelta>): void => {
    for (const node of bones.values()) {
      const delta = deltas.get(node.name);
      const bp = node.bindPivotThree;
      const br = node.bindRotationDeg;

      if (delta) {
        // Bedrock animation position delta: (+x East, +y Up, +z South)
        node.pivotGroup.position.set(
          bp[0] + delta.position[0] * unitScale,
          bp[1] + delta.position[1] * unitScale,
          bp[2] + delta.position[2] * unitScale,
        );
        setBedrockEulerDegrees(
          node.pivotGroup.rotation,
          br[0] + delta.rotation[0],
          br[1] + delta.rotation[1],
          br[2] + delta.rotation[2],
        );
        node.pivotGroup.scale.set(delta.scale[0], delta.scale[1], delta.scale[2]);
      } else {
        node.pivotGroup.position.set(bp[0], bp[1], bp[2]);
        setBedrockEulerDegrees(node.pivotGroup.rotation, br[0], br[1], br[2]);
        node.pivotGroup.scale.set(1, 1, 1);
      }
    }

    if (debugVisible && showPivots) {
      updateBoneLinks();
    }
  };

  const resetBindPose = (): void => {
    for (const node of bones.values()) {
      const bp = node.bindPivotThree;
      const br = node.bindRotationDeg;
      node.pivotGroup.position.set(bp[0], bp[1], bp[2]);
      setBedrockEulerDegrees(node.pivotGroup.rotation, br[0], br[1], br[2]);
      node.pivotGroup.scale.set(1, 1, 1);
    }
    if (debugVisible && showPivots) {
      updateBoneLinks();
    }
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    for (const geo of ownedGeometries) {
      geo.dispose();
    }
    ownedGeometries.length = 0;

    for (const geo of debugGeometries) {
      geo.dispose();
    }
    debugGeometries.length = 0;

    for (const mat of debugMaterials) {
      mat.dispose();
    }
    debugMaterials.length = 0;

    materials.dispose();
    root.clear();
    bones.clear();
  };

  const debug: SkeletonDebugResources = {
    group: debugGroup,
    setVisible: (v: boolean) => {
      debugVisible = v;
      syncDebugVisibility();
      if (v) updateBoneLinks();
    },
    setShowPivots: (v: boolean) => {
      showPivots = v;
      syncDebugVisibility();
      if (debugVisible && v) updateBoneLinks();
    },
    setShowBounds: (v: boolean) => {
      showBounds = v;
      syncDebugVisibility();
    },
    updateBoneLinks,
    dispose: () => {
      // Handled centrally by rig.dispose()
    },
  };

  return {
    root,
    bones,
    debug,
    applyPose,
    resetBindPose,
    dispose,
    get geometryCount() {
      return ownedGeometries.length + debugGeometries.length;
    },
    get materialCount() {
      return materials.materials.length + debugMaterials.length;
    },
    get textureCount() {
      return materials.textures.length;
    },
  };
}
