import { zlibSync } from 'fflate';
import type { VirtualFileSystem, YsmArchiveParser } from './types';
import { decryptYsgp, isYsgpBytes } from './ysm/YsmCrypto';
import { readYsmBinary } from './ysm/YsmBinaryReader';

/** Encodes legacy raw RGBA without relying on a browser canvas or a native image library. */
function rgbaToPng(data: Uint8Array, width: number, height: number): Uint8Array {
  if (width === 0 || height === 0 || data.length !== width * height * 4) throw new Error('YSM: Invalid RGBA image.');
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, bytes: Uint8Array): Uint8Array => {
    const result = new Uint8Array(bytes.length + 12);
    const view = new DataView(result.buffer);
    view.setUint32(0, bytes.length);
    result.set(new TextEncoder().encode(type), 4);
    result.set(bytes, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
  };
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(chunks.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of chunks) { png.set(part, offset); offset += part.length; }
  return png;
}

/** Built-in browser-compatible reader for crypto-3 YSGP archives (binary formats 16–32). */
export const ysgpArchiveParser: YsmArchiveParser = {
  name: 'ysgp-crypto3',
  extensions: ['.ysm'],
  canParse: isYsgpBytes,
  parse(bytes): VirtualFileSystem {
    const pack = readYsmBinary(decryptYsgp(bytes));
    for (const texture of pack.textures) {
      const { data, width, height, path, format } = texture;
      const rawRgba = format === 0xffffffff || (format === 0 && data.length === width * height * 4);
      pack.files.set(path, rawRgba ? rgbaToPng(data, width, height) : data);
    }
    return pack.files;
  },
};
