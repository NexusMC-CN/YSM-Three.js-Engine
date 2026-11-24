import type { MolangEvaluator } from '../molang/MolangEvaluator';

/**
 * In-memory normalized virtual file system mapping forward-slash relative paths
 * (e.g. "ysm.json", "models/main.json", "animations/main.animation.json", "textures/skin.png")
 * to raw binary buffers.
 */
export type VirtualFileSystem = Map<string, Uint8Array>;

/**
 * Extension interface for custom encrypted or proprietary archive formats
 * (e.g., `.ysm` archives decrypted via an OpenYSM WASM module).
 */
export interface YsmArchiveParser {
  /** Unique parser identifier (e.g. "openysm-wasm") */
  readonly name: string;
  /** File extensions handled by this parser (e.g. [".ysm"]) */
  readonly extensions: readonly string[];
  /**
   * Optional sniff check on raw bytes & filename.
   * Return true if this parser should handle the binary payload.
   */
  canParse?: (bytes: Uint8Array, filename?: string) => boolean;
  /**
   * Unpacks/decrypts the binary archive into a normalized VirtualFileSystem.
   */
  parse: (bytes: Uint8Array, filename?: string) => Promise<VirtualFileSystem> | VirtualFileSystem;
}

export interface YsmPackFilesInput {
  /** Optional pack display name */
  name?: string;
  /** Normalized path -> UTF-8 string, Uint8Array, Blob, or HTMLCanvasElement (for procedural textures) */
  files: Record<string, string | Uint8Array | Blob | HTMLCanvasElement>;
}

/**
 * Supported input sources for `YsmModelLoader.load(source)`.
 */
export type YsmLoadSource =
  | string
  | Blob
  | ArrayBuffer
  | Uint8Array
  | FileList
  | File[]
  | YsmPackFilesInput;

export interface YsmLoadOptions {
  /** Optional filename hint when loading from raw ArrayBuffer / Blob */
  filename?: string;
  /** Optional geometry identifier when a model JSON contains multiple geometries */
  geometryIdentifier?: string;
  /** Optional shared MolangEvaluator instance to reuse compiled expression caches across models */
  evaluator?: MolangEvaluator;
  /** Optional unit scale override (defaults to 1/16 blocks per Bedrock pixel) */
  unitScale?: number;
  /** Custom fetch function (defaults to globalThis.fetch) */
  fetchFn?: typeof fetch;
}
