import type { YsmArchiveParser } from './types';

const registry: YsmArchiveParser[] = [];

/**
 * Registers a custom archive parser extension (for example, an OpenYSM WASM `.ysm` decryptor).
 * Later registrations take priority if multiple parsers match the same extension.
 */
export function registerArchiveParser(parser: YsmArchiveParser): void {
  const existingIdx = registry.findIndex((p) => p.name === parser.name);
  if (existingIdx >= 0) {
    registry.splice(existingIdx, 1);
  }
  registry.unshift(parser);
}

/**
 * Removes a previously registered archive parser by name.
 */
export function unregisterArchiveParser(name: string): boolean {
  const idx = registry.findIndex((p) => p.name === name);
  if (idx < 0) return false;
  registry.splice(idx, 1);
  return true;
}

/**
 * Lists currently registered custom archive parsers.
 */
export function getRegisteredArchiveParsers(): readonly YsmArchiveParser[] {
  return registry.slice();
}

/**
 * Finds the highest-priority registered archive parser matching the given bytes or filename.
 */
export function findMatchingArchiveParser(
  bytes: Uint8Array,
  filename?: string,
): YsmArchiveParser | undefined {
  const lowerName = filename?.toLowerCase();

  for (const parser of registry) {
    if (parser.canParse && parser.canParse(bytes, filename)) {
      return parser;
    }
    if (lowerName && parser.extensions.some((ext) => lowerName.endsWith(ext.toLowerCase()))) {
      return parser;
    }
  }

  return undefined;
}
