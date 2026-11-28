import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ActiveLayerInfo } from '../animation/AnimationController';
import type { MolangQueryContext } from '../molang/MolangEvaluator';
import type { YsmModelInstance } from '../loader/YsmModelInstance';

export type CameraPreset = 'front' | 'side' | 'back' | 'closeup' | 'quarter';

export interface ViewportTelemetry {
  fps: number;
  rendererGeometries: number;
  rendererTextures: number;
  baselineGeometries: number;
  baselineTextures: number;
  modelDeltaGeometries: number;
  modelDeltaTextures: number;
  drawCalls: number;
  triangles: number;
  activeLayers: ActiveLayerInfo[];
  variables: Record<string, number>;
  molangCacheSize: number;
  isSoftwareGl: boolean;
}

export interface YsmViewportHandle {
  setModel: (instance: YsmModelInstance | null) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  forceRenderFrame: () => void;
  getMemorySnapshot: () => {
    geometries: number;
    textures: number;
    baselineGeometries: number;
    baselineTextures: number;
  };
}

export interface YsmViewportOptions {
  /** Read at each frame; no reactive framework is required. */
  getQuery?: () => MolangQueryContext;
  getPaused?: () => boolean;
  onTelemetry?: (telemetry: ViewportTelemetry) => void;
  onContextLost?: (lost: boolean) => void;
  /** Defaults to true. Set false when the caller owns the model. */
  disposeModelOnUnmount?: boolean;
}

export interface YsmViewportController extends YsmViewportHandle {
  /** Detach the canvas and release renderer resources. Safe to call repeatedly. */
  dispose(): void;
}

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  quarter: { pos: [2.35, 1.85, 4.45], target: [0, 0.62, 0] },
  front: { pos: [0, 1.55, 4.75], target: [0, 0.62, 0] },
  side: { pos: [4.65, 1.55, 0], target: [0, 0.62, 0] },
  back: { pos: [0, 1.65, -4.75], target: [0, 0.62, 0] },
  closeup: { pos: [0.65, 1.85, 1.75], target: [0, 1.48, 0] },
};

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size * 0.48,
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Create a browser viewport. Importing this module is safe during SSR. */
export function createYsmViewport(mountEl: HTMLElement, options: YsmViewportOptions = {}): YsmViewportController {
  let activeModel: YsmModelInstance | null = null;
  const transition = { active: false, targetPos: new THREE.Vector3(), targetLook: new THREE.Vector3() };
  const isSoftwareGl = detectSoftwareWebGL();
  const width = Math.max(1, mountEl.clientWidth);
  const height = Math.max(1, mountEl.clientHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#11141b');
  scene.fog = new THREE.FogExp2('#11141b', 0.045);

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 80);
  camera.position.set(2.35, 1.85, 4.45);

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  mountEl.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  // Studio PBR Environment reflection (mandatory across GPU & software WebGL)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  roomEnv.dispose();
  pmrem.dispose();

  // 3-Point Warm/Cool Studio Lighting Rig
  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff5e4, 1.65);
  keyLight.position.set(3.8, 6.2, 4.4);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.camera.left = -2.6;
    keyLight.shadow.camera.right = 2.6;
    keyLight.shadow.camera.top = 3.0;
    keyLight.shadow.camera.bottom = -1.2;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.72);
  rimLight.position.set(-3.4, 3.6, -4.2);
  scene.add(rimLight);

  // Ground Turntable Stage & Contact Shadow Grounding (strict Y offsets to prevent Z-fighting)
  const stageGroup = new THREE.Group();
  stageGroup.name = 'studio:stage';

  const floorGeo = new THREE.CircleGeometry(14, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x171b24,
    roughness: 0.92,
    metalness: 0.05,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.02;
  floorMesh.receiveShadow = true;
  stageGroup.add(floorMesh);

  const turntableGeo = new THREE.CylinderGeometry(1.15, 1.22, 0.02, 48);
  const turntableMat = new THREE.MeshStandardMaterial({
    color: 0x1e2430,
    roughness: 0.72,
    metalness: 0.18,
  });
  const turntableMesh = new THREE.Mesh(turntableGeo, turntableMat);
  turntableMesh.position.y = -0.01;
  turntableMesh.receiveShadow = true;
  stageGroup.add(turntableMesh);

  const ringGeo = new THREE.RingGeometry(1.13, 1.155, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.002;
  stageGroup.add(ringMesh);

  // Subtle +Z forward direction notch on the turntable rim
  const notchGeo = new THREE.ConeGeometry(0.055, 0.12, 3);
  const notchMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const notchMesh = new THREE.Mesh(notchGeo, notchMat);
  notchMesh.rotation.x = Math.PI / 2;
  notchMesh.position.set(0, 0.008, 1.22);
  stageGroup.add(notchMesh);

  const gridHelper = new THREE.GridHelper(16, 32, 0x334155, 0x1e2533);
  gridHelper.position.y = -0.015;
  stageGroup.add(gridHelper);

  const shadowTex = createContactShadowTexture();
  const shadowPlaneGeo = new THREE.CircleGeometry(0.78, 32);
  const shadowPlaneMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.004;
  stageGroup.add(shadowPlane);

  scene.add(stageGroup);

  // OrbitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.62, 0);
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.07;
  controls.minDistance = 0.8;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  const onControlStart = () => {
    transition.active = false;
  };
  controls.addEventListener('start', onControlStart);

  // WebGL context loss / restore handlers
  const handleContextLost = (ev: Event) => {
    ev.preventDefault();
    options.onContextLost?.(true);
  };
  const handleContextRestored = () => {
    options.onContextLost?.(false);
  };
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

  // Render 1 baseline frame before attaching any model so baseline memory is exact
  renderer.render(scene, camera);
  const baselineMemory = {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  // Resize handler
  const handleResize = () => {
    if (!mountEl) return;
    const w = Math.max(1, mountEl.clientWidth);
    const h = Math.max(1, mountEl.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', handleResize);
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : undefined;
  resizeObserver?.observe(mountEl);

  // Frame loop with software-WebGL afterDraw pacing
  let disposed = false;
  let frameId = 0;
  let lastTime = performance.now();
  let fpsFrames = 0;
  let fpsAccum = 0;
  let currentFps = 60;
  let lastTelemetryPush = 0;

  let pendingSync: WebGLSync | null = null;
  const afterDraw = (cb: () => void) => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = pendingSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (disposed) {
        if (sync) gl.deleteSync(sync);
        pendingSync = null;
        return;
      }
      const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (status === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        pendingSync = null;
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  };

  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0), 0.1);

    // Smooth camera preset transition
    const tr = transition;
    if (tr.active) {
      const lambda = 7.5;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tr.targetPos.x, lambda, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, tr.targetPos.y, lambda, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tr.targetPos.z, lambda, dt);
      controls.target.x = THREE.MathUtils.damp(controls.target.x, tr.targetLook.x, lambda, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, tr.targetLook.y, lambda, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, tr.targetLook.z, lambda, dt);
      if (
        camera.position.distanceTo(tr.targetPos) < 0.015 &&
        controls.target.distanceTo(tr.targetLook) < 0.015
      ) {
        camera.position.copy(tr.targetPos);
        controls.target.copy(tr.targetLook);
        tr.active = false;
      }
    }

    controls.update();

    const model = activeModel;
    if (model && !model.isDisposed && !options.getPaused?.()) {
      model.update(dt, options.getQuery?.());
    }

    renderer.render(scene, camera);

    // Push telemetry at about 6 Hz.
    fpsFrames++;
    fpsAccum += rawDt;
    if (fpsAccum >= 0.35) {
      currentFps = Math.round(fpsFrames / fpsAccum);
      fpsFrames = 0;
      fpsAccum = 0;
    }

    if (now - lastTelemetryPush >= 160) {
      lastTelemetryPush = now;
      const mem = renderer.info.memory;
      const renderInfo = renderer.info.render;
      const base = baselineMemory;

      options.onTelemetry?.({
        fps: currentFps,
        rendererGeometries: mem.geometries,
        rendererTextures: mem.textures,
        baselineGeometries: base.geometries,
        baselineTextures: base.textures,
        modelDeltaGeometries: Math.max(0, mem.geometries - base.geometries),
        modelDeltaTextures: Math.max(0, mem.textures - base.textures),
        drawCalls: renderInfo.calls,
        triangles: renderInfo.triangles,
        activeLayers: model && !model.isDisposed ? model.getActiveLayers() : [],
        variables: model && !model.isDisposed ? model.getVariables() : {},
        molangCacheSize: model && !model.isDisposed ? model.controller.evaluator.cacheSize : 0,
        isSoftwareGl,
      });
    }

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }
  };

  if (isSoftwareGl) {
    afterDraw(tick);
  } else {
    frameId = requestAnimationFrame(tick);
  }
  return {
    setModel(instance: YsmModelInstance | null) {
      if (disposed) return;

      const prev = activeModel;
      if (prev && prev !== instance) {
        prev.root.removeFromParent();
      }
      activeModel = instance;
      if (scene && instance) {
        scene.add(instance.root);

        const bounds = new THREE.Box3();
        instance.root.updateWorldMatrix(true, true);
        instance.root.traverseVisible((object) => {
          if (object instanceof THREE.Mesh) bounds.expandByObject(object);
        });
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        if (camera && sphere.radius > 0 && Number.isFinite(sphere.radius)) {
          // Imported packs can be much taller or wider than the built-in examples.
          const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
          const halfHorizontalFov = Math.atan(Math.tan(halfFov) * camera.aspect);
          const distance = sphere.radius / Math.sin(Math.min(halfFov, halfHorizontalFov)) * 1.1;

          transition.targetLook.copy(sphere.center);
          const preset = CAMERA_PRESETS.quarter;
          transition.targetPos.set(
            preset.pos[0] - preset.target[0],
            preset.pos[1] - preset.target[1],
            preset.pos[2] - preset.target[2],
          ).normalize().multiplyScalar(distance).add(sphere.center);
          transition.active = true;
        }
      }
    },
    setCameraPreset(preset: CameraPreset) {
      if (disposed) return;
      const def = CAMERA_PRESETS[preset];
      transition.targetPos.set(def.pos[0], def.pos[1], def.pos[2]);
      transition.targetLook.set(def.target[0], def.target[1], def.target[2]);
      transition.active = true;
    },
    forceRenderFrame() {
      if (!disposed) {
        renderer.render(scene, camera);
      }
    },
    getMemorySnapshot() {
      const info = disposed ? undefined : renderer.info.memory;
      return {
        geometries: info?.geometries ?? 0,
        textures: info?.textures ?? 0,
        baselineGeometries: baselineMemory.geometries,
        baselineTextures: baselineMemory.textures,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (pendingSync) {
        (renderer.getContext() as WebGL2RenderingContext).deleteSync(pendingSync);
        pendingSync = null;
      }
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      if (activeModel && !activeModel.isDisposed) {
        activeModel.root.removeFromParent();
        if (options.disposeModelOnUnmount !== false) activeModel.dispose();
      }
      activeModel = null;

      // Dispose studio stage geometries, materials, and environment
      floorGeo.dispose();
      floorMat.dispose();
      turntableGeo.dispose();
      turntableMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      notchGeo.dispose();
      notchMat.dispose();
      gridHelper.geometry.dispose();
      if (Array.isArray(gridHelper.material)) {
        gridHelper.material.forEach((m) => m.dispose());
      } else {
        gridHelper.material.dispose();
      }
      shadowPlaneGeo.dispose();
      shadowPlaneMat.dispose();
      shadowTex.dispose();
      envRT.dispose();
      keyLight.shadow.dispose();

      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
