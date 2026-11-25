import { unzipSync } from 'fflate';
import { BedrockModelParser } from '../parser/BedrockModelParser';
import { BedrockAnimationParser } from '../parser/BedrockAnimationParser';
import type { ParsedAnimationClip, ParsedModel, YsmManifest } from '../parser/types';
import { AnimationController } from '../animation/AnimationController';
import { TextureManager, type TextureEntryInput } from '../renderer/TextureManager';
import { BEDROCK_UNIT_SCALE } from '../renderer/CubeGeometryBuilder';
import { buildModelRig } from '../renderer/RigBuilder';
import { findMatchingArchiveParser } from './ArchiveRegistry';
import { YsmModelInstance } from './YsmModelInstance';
import { ysgpArchiveParser } from './YsgpArchiveParser';
import { isYsgpBytes } from './ysm/YsmCrypto';
import type {
  VirtualFileSystem,
  YsmLoadOptions,
  YsmLoadSource,
  YsmPackFilesInput,
} from './types';

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/');
}

/** Strips a shared top-level wrapper folder (common in zipped model packs) */
function stripCommonRootPrefix(vfs: VirtualFileSystem): VirtualFileSystem {
  const keys = Array.from(vfs.keys()).filter((k) => k && !k.endsWith('/'));
  if (keys.length === 0) return vfs;

  // Only strip if every file shares the exact same first directory segment
  const firstSlash = keys[0].indexOf('/');
  if (firstSlash <= 0) return vfs;
  const candidatePrefix = keys[0].slice(0, firstSlash + 1);

  if (keys.every((k) => k.startsWith(candidatePrefix))) {
    const stripped: VirtualFileSystem = new Map();
    for (const [k, v] of vfs.entries()) {
      if (k.startsWith(candidatePrefix)) {
        const rest = k.slice(candidatePrefix.length);
        if (rest) stripped.set(rest, v);
      }
    }
    return stripped;
  }

  return vfs;
}

/** Detects standard PK\x03\x04 or empty PK\x05\x06 ZIP headers */
export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/** Detects `.ysm` archive signature or extension */
function isYsmArchive(bytes: Uint8Array, filename?: string): boolean {
  if (filename && filename.toLowerCase().endsWith('.ysm')) return true;
  // YSM binary header starts with "YSM" magic bytes
  if (bytes.length >= 3 && bytes[0] === 0x59 && bytes[1] === 0x53 && bytes[2] === 0x4d) {
    return true;
  }
  return false;
}

function isPackFilesInput(source: YsmLoadSource): source is YsmPackFilesInput {
  return (
    typeof source === 'object' &&
    source !== null &&
    'files' in source &&
    typeof (source as YsmPackFilesInput).files === 'object'
  );
}

function isFileListLike(source: YsmLoadSource): source is FileList | File[] {
  if (Array.isArray(source)) return true;
  return (
    typeof FileList !== 'undefined' &&
    source instanceof FileList
  );
}

interface ResolvedPackPayload {
  manifest?: YsmManifest;
  modelJsonText: string;
  animationJsonTexts: string[];
  textures: TextureEntryInput[];
}

/**
 * Unpacks a binary Zip or custom registered archive into a normalized `VirtualFileSystem`.
 * Exported for unit testing and custom pipelines.
 */
export async function unpackArchiveBytes(
  bytes: Uint8Array,
  filename?: string,
): Promise<VirtualFileSystem> {
  // 1. Check custom registered archive parsers first (e.g., OpenYSM WASM .ysm decryptor)
  const customParser = findMatchingArchiveParser(bytes, filename);
  if (customParser) {
    const unpacked = await customParser.parse(bytes, filename);
    return stripCommonRootPrefix(unpacked);
  }

  // 2. Native YSGP support; explicit custom parsers above still take priority.
  if (isYsgpBytes(bytes)) {
    return stripCommonRootPrefix(await ysgpArchiveParser.parse(bytes, filename));
  }

  // Unsupported `.ysm` variants can still be provided by a registered parser.
  if (isYsmArchive(bytes, filename) && !isZipBytes(bytes)) {
    throw new Error(
      'YsmModelLoader: Unsupported ".ysm" archive signature. Built-in support expects YSGP (crypto 3). ' +
        'Use registerArchiveParser() for other archive formats.',
    );
  }

  // 3. Standard Zip archive via fflate
  if (!isZipBytes(bytes)) {
    throw new Error(
      `YsmModelLoader: Unrecognized binary archive${filename ? ` ("${filename}")` : ''}. Expected a .zip archive or a format handled by registerArchiveParser().`,
    );
  }

  const rawEntries = unzipSync(bytes);
  const vfs: VirtualFileSystem = new Map();
  for (const [rawPath, data] of Object.entries(rawEntries)) {
    if (rawPath.endsWith('/') || rawPath.startsWith('__MACOSX/')) continue;
    const norm = normalizePath(rawPath);
    if (norm) {
      vfs.set(norm, data);
    }
  }
  return stripCommonRootPrefix(vfs);
}

/**
 * High-level loader for Yes Steve Model (YSM) packs.
 *
 * Supports:
 * - Folder URL (`'/path/to/pack/'`) or remote `.zip` / `.ysm` URL
 * - Zip `Blob`, `ArrayBuffer`, or `Uint8Array` (decoded via `fflate`)
 * - Browser `FileList` / `File[]` (folder drag-and-drop or file picker)
 * - In-memory `YsmPackFilesInput` (ideal for procedural skins or bundled demos)
 * - YSGP `.ysm` archives (crypto 3, binary formats 16–32), with no registration required
 * - Additional archive formats via `registerArchiveParser()`
 */
export class YsmModelLoader {
  readonly modelParser = new BedrockModelParser();
  readonly animationParser = new BedrockAnimationParser();
  private readonly textureManager = new TextureManager();

  /**
   * Loads, parses, builds, and returns a ready-to-render `YsmModelInstance`.
   */
  async load(source: YsmLoadSource, options: YsmLoadOptions = {}): Promise<YsmModelInstance> {
    const payload = await this.resolveSource(source, options);

    const parsedModel: ParsedModel = this.modelParser.parse(payload.modelJsonText, {
      geometryIdentifier: options.geometryIdentifier,
      textureCount: payload.textures.length || undefined,
      boneTextures: payload.manifest?.boneTextures,
    });

    const animSets = payload.animationJsonTexts.map((txt) => this.animationParser.parse(txt));
    const mergedClips: Record<string, ParsedAnimationClip> =
      this.animationParser.mergeSets(animSets);

    const boneNames = parsedModel.bones.map((b) => b.name);
    const controller = new AnimationController(mergedClips, boneNames, options.evaluator);

    const materials = await this.textureManager.loadMaterials(payload.textures);
    const rig = buildModelRig(
      parsedModel,
      materials,
      options.unitScale ?? BEDROCK_UNIT_SCALE,
    );
    rig.root.scale.set(payload.manifest?.widthScale ?? 1, payload.manifest?.heightScale ?? 1, payload.manifest?.widthScale ?? 1);
    for (const name of payload.manifest?.autoAnimations ?? []) {
      controller.play(name, { loop: true, persistent: true });
    }

    const instance = new YsmModelInstance(parsedModel, rig, controller, payload.manifest);
    instance.update(0);
    return instance;
  }

  /**
   * Extracts normalized model JSON, animation JSONs, and textures from a VirtualFileSystem.
   * Exposed as a helper for testing and custom loaders.
   */
  extractFromVirtualFileSystem(
    vfs: VirtualFileSystem,
    extraCanvasTextures?: Map<string, HTMLCanvasElement>,
  ): ResolvedPackPayload {
    const findEntry = (target: string): [string, Uint8Array] | undefined => {
      const norm = normalizePath(target);
      const exact = vfs.get(norm);
      if (exact) return [norm, exact];
      const lower = norm.toLowerCase();
      for (const [k, v] of vfs.entries()) {
        if (k.toLowerCase() === lower) return [k, v];
      }
      return undefined;
    };

    // 1. Optional YSM v2 manifest (`ysm.json` or `info.json`)
    let manifest: YsmManifest | undefined;
    const manifestEntry = findEntry('ysm.json') ?? findEntry('info.json');
    if (manifestEntry) {
      try {
        manifest = this.modelParser.parseManifest(textDecoder.decode(manifestEntry[1]));
      } catch {
        manifest = undefined;
      }
    }

    // 2. Locate main model JSON
    let modelEntry =
      (manifest ? findEntry(manifest.mainModelPath) : undefined) ??
      findEntry('models/main.json') ??
      findEntry('main.json') ??
      findEntry('model/main.json');

    if (!modelEntry) {
      for (const [path, data] of vfs.entries()) {
        const lower = path.toLowerCase();
        if (
          lower.endsWith('.json') &&
          !lower.endsWith('.animation.json') &&
          !lower.endsWith('ysm.json') &&
          !lower.endsWith('info.json') &&
          !lower.includes('arm.json')
        ) {
          modelEntry = [path, data];
          break;
        }
      }
    }

    if (!modelEntry) {
      throw new Error(
        'YsmModelLoader: Could not locate a Bedrock model JSON (e.g. "models/main.json" or "main.json").',
      );
    }

    const modelJsonText = textDecoder.decode(modelEntry[1]);

    // 3. Locate animation JSON files
    const animPathsSeen = new Set<string>();
    const animationJsonTexts: string[] = [];

    if (manifest) {
      for (const animPath of manifest.animationPaths) {
        const entry = findEntry(animPath);
        if (entry && !animPathsSeen.has(entry[0])) {
          animPathsSeen.add(entry[0]);
          animationJsonTexts.push(textDecoder.decode(entry[1]));
        }
      }
    }

    for (const [path, data] of vfs.entries()) {
      const lower = path.toLowerCase();
      if (lower.endsWith('.animation.json') && !lower.startsWith('vehicles/') && !lower.startsWith('projectiles/') && !animPathsSeen.has(path)) {
        animPathsSeen.add(path);
        animationJsonTexts.push(textDecoder.decode(data));
      }
    }

    // 4. Collect textures (respecting manifest ordering first, then remaining PNGs)
    const textures: TextureEntryInput[] = [];
    const texPathsSeen = new Set<string>();

    const tryAddTexture = (id: string, targetPath: string): void => {
      const norm = normalizePath(targetPath);
      if (texPathsSeen.has(norm.toLowerCase())) return;

      if (extraCanvasTextures?.has(norm)) {
        texPathsSeen.add(norm.toLowerCase());
        textures.push({ id, source: extraCanvasTextures.get(norm)! });
        return;
      }

      const entry = findEntry(norm);
      if (entry) {
        texPathsSeen.add(entry[0].toLowerCase());
        textures.push({ id, source: entry[1] });
      }
    };

    if (manifest) {
      for (const texDesc of manifest.textures) {
        tryAddTexture(texDesc.id, texDesc.path);
      }
    }

    if (extraCanvasTextures) {
      for (const [path, canvas] of extraCanvasTextures.entries()) {
        if (!texPathsSeen.has(path.toLowerCase())) {
          texPathsSeen.add(path.toLowerCase());
          textures.push({ id: path, source: canvas });
        }
      }
    }

    for (const [path, data] of vfs.entries()) {
      const lower = path.toLowerCase();
      if (
        (lower.endsWith('.png') || lower.endsWith('.webp')) &&
        !lower.includes('/gui/') &&
        !texPathsSeen.has(lower)
      ) {
        texPathsSeen.add(lower);
        textures.push({ id: path, source: data });
      }
    }

    return {
      manifest,
      modelJsonText,
      animationJsonTexts,
      textures,
    };
  }

  private async resolveSource(
    source: YsmLoadSource,
    options: YsmLoadOptions,
  ): Promise<ResolvedPackPayload> {
    // Case A: In-memory pack files object (supports strings, Uint8Arrays, Blobs, Canvas textures)
    if (isPackFilesInput(source)) {
      const vfs: VirtualFileSystem = new Map();
      const canvasTextures = new Map<string, HTMLCanvasElement>();

      for (const [rawPath, content] of Object.entries(source.files)) {
        const norm = normalizePath(rawPath);
        if (typeof HTMLCanvasElement !== 'undefined' && content instanceof HTMLCanvasElement) {
          canvasTextures.set(norm, content);
        } else if (typeof content === 'string') {
          vfs.set(norm, textEncoder.encode(content));
        } else if (content instanceof Uint8Array) {
          vfs.set(norm, content);
        } else if (content instanceof Blob) {
          vfs.set(norm, new Uint8Array(await content.arrayBuffer()));
        }
      }

      return this.extractFromVirtualFileSystem(stripCommonRootPrefix(vfs), canvasTextures);
    }

    // Case B: FileList / File[] (from <input webkitdirectory> or drag-and-drop)
    if (isFileListLike(source)) {
      const files = Array.from(source);
      if (files.length === 0) {
        throw new Error('YsmModelLoader: Provided FileList is empty.');
      }

      // Single archive file (.zip or .ysm)
      if (files.length === 1) {
        const single = files[0];
        const lower = single.name.toLowerCase();
        if (lower.endsWith('.zip') || lower.endsWith('.ysm')) {
          const bytes = new Uint8Array(await single.arrayBuffer());
          const vfs = await unpackArchiveBytes(bytes, single.name);
          return this.extractFromVirtualFileSystem(vfs);
        }
      }

      const vfs: VirtualFileSystem = new Map();
      for (const file of files) {
        const relPath = normalizePath(
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        );
        vfs.set(relPath, new Uint8Array(await file.arrayBuffer()));
      }
      return this.extractFromVirtualFileSystem(stripCommonRootPrefix(vfs));
    }

    // Case C: Raw binary archive (Blob, ArrayBuffer, Uint8Array)
    if (
      source instanceof Blob ||
      source instanceof ArrayBuffer ||
      source instanceof Uint8Array
    ) {
      const bytes =
        source instanceof Uint8Array
          ? source
          : source instanceof ArrayBuffer
            ? new Uint8Array(source)
            : new Uint8Array(await source.arrayBuffer());
      const filename =
        options.filename ?? (typeof File !== 'undefined' && source instanceof File ? source.name : undefined);
      const vfs = await unpackArchiveBytes(bytes, filename);
      return this.extractFromVirtualFileSystem(vfs);
    }

    // Case D: URL string (either archive URL ending in .zip/.ysm or folder base URL)
    if (typeof source === 'string') {
      return this.resolveUrlSource(source, options);
    }

    throw new Error('YsmModelLoader: Unsupported load source.');
  }

  private async resolveUrlSource(
    rawUrl: string,
    options: YsmLoadOptions,
  ): Promise<ResolvedPackPayload> {
    const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    const cleanUrl = rawUrl.split('?')[0].toLowerCase();

    // Direct .zip or .ysm URL
    if (cleanUrl.endsWith('.zip') || cleanUrl.endsWith('.ysm')) {
      const resp = await fetchFn(rawUrl);
      if (!resp.ok) {
        throw new Error(`YsmModelLoader: HTTP ${resp.status} while fetching "${rawUrl}"`);
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const vfs = await unpackArchiveBytes(bytes, options.filename ?? rawUrl);
      return this.extractFromVirtualFileSystem(vfs);
    }

    // Folder URL mode: probe ysm.json, otherwise fall back to standard Bedrock/YSM layout
    const baseUrl = rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`;

    const tryFetchText = async (relPath: string): Promise<string | null> => {
      try {
        const resp = await fetchFn(`${baseUrl}${normalizePath(relPath)}`);
        if (!resp.ok) return null;
        return await resp.text();
      } catch {
        return null;
      }
    };

    const tryFetchExists = async (relPath: string): Promise<string | null> => {
      const fullUrl = `${baseUrl}${normalizePath(relPath)}`;
      try {
        const resp = await fetchFn(fullUrl);
        if (!resp.ok) return null;
        return fullUrl;
      } catch {
        return null;
      }
    };

    let manifest: YsmManifest | undefined;
    const manifestText = (await tryFetchText('ysm.json')) ?? (await tryFetchText('info.json'));
    if (manifestText) {
      manifest = this.modelParser.parseManifest(manifestText);
    }

    const modelCandidates = manifest
      ? [manifest.mainModelPath, 'models/main.json', 'main.json']
      : ['models/main.json', 'main.json'];

    let modelJsonText: string | null = null;
    for (const candidate of modelCandidates) {
      modelJsonText = await tryFetchText(candidate);
      if (modelJsonText) break;
    }

    if (!modelJsonText) {
      throw new Error(
        `YsmModelLoader: Failed to fetch model JSON from folder "${baseUrl}" (tried ${modelCandidates.join(', ')}).`,
      );
    }

    const animCandidates = manifest?.animationPaths.length
      ? manifest.animationPaths
      : ['animations/main.animation.json', 'main.animation.json', 'animations/extra.animation.json'];

    const animationJsonTexts: string[] = [];
    for (const candidate of animCandidates) {
      const txt = await tryFetchText(candidate);
      if (txt) animationJsonTexts.push(txt);
    }

    const textures: TextureEntryInput[] = [];
    if (manifest?.textures.length) {
      for (const texDesc of manifest.textures) {
        textures.push({
          id: texDesc.id,
          source: `${baseUrl}${normalizePath(texDesc.path)}`,
        });
      }
    } else {
      const fallbackTexCandidates = ['textures/texture.png', 'textures/default.png', 'texture.png'];
      for (const candidate of fallbackTexCandidates) {
        const okUrl = await tryFetchExists(candidate);
        if (okUrl) {
          textures.push({ id: candidate, source: okUrl });
          break;
        }
      }
    }

    return {
      manifest,
      modelJsonText,
      animationJsonTexts,
      textures,
    };
  }
}
