import * as THREE from 'three';

export interface TextureEntryInput {
  id: string;
  /** URL string, Blob, Uint8Array (PNG bytes), or pre-created HTMLCanvasElement */
  source: string | Blob | Uint8Array | HTMLCanvasElement;
}

export interface ManagedMaterialTable {
  /** Default material (index 0) */
  defaultMaterial: THREE.MeshStandardMaterial;
  /** Ordered list of materials indexed by textureIndex / UV page */
  byIndex: THREE.MeshStandardMaterial[];
  /** Map of materials keyed by texture id or normalized filename */
  byKey: Map<string, THREE.MeshStandardMaterial>;
  /** All created GPU textures tracked for deterministic disposal */
  textures: THREE.Texture[];
  /** All created GPU materials tracked for deterministic disposal */
  materials: THREE.MeshStandardMaterial[];
  /** Releases all textures, materials, and temporary object URLs */
  dispose: () => void;
}

/**
 * Configures a Three.js texture strictly per Minecraft Bedrock / YSM rendering standards:
 * - `flipY = false` (Bedrock UV origin is top-left)
 * - `magFilter = NearestFilter` & `minFilter = NearestFilter` (crisp pixel art)
 * - `colorSpace = SRGBColorSpace`
 */
export function configureBedrockTexture(texture: THREE.Texture): THREE.Texture {
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMaterialFromTexture(texture: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    alphaTest: 0.1,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.84,
    metalness: 0.06,
  });
}

function createFallbackTexture(): THREE.DataTexture {
  // 2x2 neutral checkerboard fallback if a model pack ships without any PNG textures
  const data = new Uint8Array([
    190, 196, 206, 255, 130, 138, 150, 255,
    130, 138, 150, 255, 190, 196, 206, 255,
  ]);
  const tex = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  return configureBedrockTexture(tex) as THREE.DataTexture;
}

/**
 * Loads one or more textures for a YSM model pack and builds a deterministic
 * multi-texture material table.
 */
export class TextureManager {
  private readonly loader = new THREE.TextureLoader();

  async loadMaterials(entries: TextureEntryInput[]): Promise<ManagedMaterialTable> {
    const textures: THREE.Texture[] = [];
    const materials: THREE.MeshStandardMaterial[] = [];
    const byIndex: THREE.MeshStandardMaterial[] = [];
    const byKey = new Map<string, THREE.MeshStandardMaterial>();
    const objectUrls: string[] = [];

    const loadOne = async (entry: TextureEntryInput): Promise<THREE.Texture> => {
      if (typeof HTMLCanvasElement !== 'undefined' && entry.source instanceof HTMLCanvasElement) {
        const tex = new THREE.CanvasTexture(entry.source);
        return configureBedrockTexture(tex);
      }

      let url: string;
      if (typeof entry.source === 'string') {
        url = entry.source;
      } else {
        const blob =
          entry.source instanceof Blob
            ? entry.source
            : entry.source instanceof Uint8Array
              ? new Blob([entry.source.slice().buffer], { type: 'image/png' })
              : undefined;
        if (!blob) throw new Error(`TextureManager: Unsupported texture source "${entry.id}"`);
        url = URL.createObjectURL(blob);
        objectUrls.push(url);
      }

      const tex = await new Promise<THREE.Texture>((resolve, reject) => {
        this.loader.load(
          url,
          (loaded) => resolve(configureBedrockTexture(loaded)),
          undefined,
          (err) => reject(err ?? new Error(`TextureManager: Failed to load texture "${entry.id}"`)),
        );
      });
      return tex;
    };

    try {
      for (const entry of entries) {
        const tex = await loadOne(entry);
        const mat = createMaterialFromTexture(tex);
        textures.push(tex);
        materials.push(mat);
        byIndex.push(mat);

        // Register by explicit id, lowercase id, and basename without extension
        byKey.set(entry.id, mat);
        byKey.set(entry.id.toLowerCase(), mat);
        const baseName = entry.id.split('/').pop()?.replace(/\.[^.]+$/, '');
        if (baseName) {
          byKey.set(baseName, mat);
          byKey.set(baseName.toLowerCase(), mat);
        }
      }
    } finally {
      // Revoke temporary Blob object URLs once textures are decoded into Image objects
      for (const objUrl of objectUrls) {
        URL.revokeObjectURL(objUrl);
      }
    }

    if (materials.length === 0) {
      const fallbackTex = createFallbackTexture();
      const fallbackMat = createMaterialFromTexture(fallbackTex);
      textures.push(fallbackTex);
      materials.push(fallbackMat);
      byIndex.push(fallbackMat);
      byKey.set('default', fallbackMat);
    }

    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const mat of materials) {
        mat.map = null;
        mat.dispose();
      }
      for (const tex of textures) {
        tex.dispose();
      }
      materials.length = 0;
      textures.length = 0;
      byIndex.length = 0;
      byKey.clear();
    };

    return {
      defaultMaterial: materials[0],
      byIndex,
      byKey,
      textures,
      materials,
      dispose,
    };
  }
}
