import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ActiveLayerInfo, MolangQueryContext } from '../lib';
import { YsmModelInstance } from '../lib';

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

interface YsmViewportProps {
  queryRef: React.MutableRefObject<MolangQueryContext>;
  pausedRef: React.MutableRefObject<boolean>;
  onTelemetry: (telemetry: ViewportTelemetry) => void;
  onContextLost?: (lost: boolean) => void;
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

export const YsmViewport = forwardRef<YsmViewportHandle, YsmViewportProps>(
  function YsmViewport({ queryRef, pausedRef, onTelemetry, onContextLost }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const activeModelRef = useRef<YsmModelInstance | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const baselineMemRef = useRef({ geometries: 0, textures: 0 });
    const camTransitionRef = useRef<{
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    }>({
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    });
    const onTelemetryRef = useRef(onTelemetry);
    onTelemetryRef.current = onTelemetry;
    const onContextLostRef = useRef(onContextLost);
    onContextLostRef.current = onContextLost;

    useImperativeHandle(ref, () => ({
      setModel(instance: YsmModelInstance | null) {
        const scene = sceneRef.current;
        const prev = activeModelRef.current;
        if (prev && prev !== instance) {
          prev.root.removeFromParent();
        }
        activeModelRef.current = instance;
        if (scene && instance) {
          scene.add(instance.root);
          const camera = cameraRef.current;
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
            const transition = camTransitionRef.current;
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
        const def = CAMERA_PRESETS[preset];
        camTransitionRef.current.targetPos.set(def.pos[0], def.pos[1], def.pos[2]);
        camTransitionRef.current.targetLook.set(def.target[0], def.target[1], def.target[2]);
        camTransitionRef.current.active = true;
      },
      forceRenderFrame() {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      },
      getMemorySnapshot() {
        const info = rendererRef.current?.info.memory;
        return {
          geometries: info?.geometries ?? 0,
          textures: info?.textures ?? 0,
          baselineGeometries: baselineMemRef.current.geometries,
          baselineTextures: baselineMemRef.current.textures,
        };
      },
    }));

    useEffect(() => {
      const mountEl = containerRef.current;
      if (!mountEl) return;

      const isSoftwareGl = detectSoftwareWebGL();
      const width = mountEl.clientWidth || window.innerWidth;
      const height = mountEl.clientHeight || window.innerHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#11141b');
      scene.fog = new THREE.FogExp2('#11141b', 0.045);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 80);
      camera.position.set(2.35, 1.85, 4.45);
      cameraRef.current = camera;

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
      rendererRef.current = renderer;

      mountEl.innerHTML = '';
      mountEl.appendChild(renderer.domElement);

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
        camTransitionRef.current.active = false;
      };
      controls.addEventListener('start', onControlStart);

      // WebGL context loss / restore handlers
      const handleContextLost = (ev: Event) => {
        ev.preventDefault();
        onContextLostRef.current?.(true);
      };
      const handleContextRestored = () => {
        onContextLostRef.current?.(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      // Render 1 baseline frame before attaching any model so baseline memory is exact
      renderer.render(scene, camera);
      baselineMemRef.current = {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      };

      // If a model was already supplied before mount completed, attach it now
      if (activeModelRef.current) {
        scene.add(activeModelRef.current.root);
      }

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      // Resize handler
      const handleResize = () => {
        if (!mountEl) return;
        const w = mountEl.clientWidth || window.innerWidth;
        const h = mountEl.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      // Frame loop with software-WebGL afterDraw pacing
      let disposed = false;
      let frameId = 0;
      let lastTime = performance.now();
      let fpsFrames = 0;
      let fpsAccum = 0;
      let currentFps = 60;
      let lastTelemetryPush = 0;

      const afterDraw = (cb: () => void) => {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl || typeof gl.fenceSync !== 'function') {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (status === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
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
        const tr = camTransitionRef.current;
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

        const model = activeModelRef.current;
        if (model && !model.isDisposed && !pausedRef.current) {
          model.update(dt, queryRef.current);
        }

        renderer.render(scene, camera);

        // Track FPS and throttle React HUD telemetry to ~6 Hz (never 60Hz setState)
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
          const base = baselineMemRef.current;

          onTelemetryRef.current({
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

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        window.removeEventListener('resize', handleResize);
        controls.removeEventListener('start', onControlStart);
        controls.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

        if (activeModelRef.current && !activeModelRef.current.isDisposed) {
          activeModelRef.current.dispose();
        }
        activeModelRef.current = null;

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

        scene.clear();
        renderer.dispose();
        sceneRef.current = null;
        rendererRef.current = null;
      };
    }, [queryRef, pausedRef]);

    return (
      <div
        ref={containerRef}
        data-testid="ysm-webgl-canvas"
        className="w-full h-full relative select-none"
      />
    );
  },
);
