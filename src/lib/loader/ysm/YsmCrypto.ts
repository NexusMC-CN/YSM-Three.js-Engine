/** Crypto-3 YSGP container, adapted from OpenYSM (MIT); see THIRD_PARTY_NOTICES.md. */
import { decompress, Decompress } from 'fzstd';
import { ysmCityHash64 } from './CityHash';

const FILE_SEED = 0x9e5599db80c67c29n;
const RESOURCE_SEED = 0xa62b1a2c43842bc3n;
const KEY_SEED = 0xd017cbba7b5d3581n;
const MAX_PAYLOAD = 128 * 1024 * 1024;
const u64 = (value: bigint): bigint => BigInt.asUintN(64, value);

export function isYsgpBytes(bytes: Uint8Array): boolean {
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return bytes[offset] === 0x59 && bytes[offset + 1] === 0x53 && bytes[offset + 2] === 0x47 && bytes[offset + 3] === 0x50;
}

function mt19937Xor(bytes: Uint8Array, seed: bigint): void {
  const state = new BigUint64Array(312);
  state[0] = seed;
  for (let i = 1; i < state.length; i++) {
    state[i] = u64(6364136223846793005n * (state[i - 1] ^ (state[i - 1] >> 62n)) + BigInt(i));
  }
  let index = state.length;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    if (index === state.length) {
      for (let i = 0; i < state.length; i++) {
        const x = (state[i] & 0xffffffff80000000n) | (state[(i + 1) % 312] & 0x7fffffffn);
        state[i] = state[(i + 156) % 312] ^ (x >> 1n) ^ ((x & 1n) ? 0xb5026f5aa96619e9n : 0n);
      }
      index = 0;
    }
    let value = state[index++];
    value ^= (value >> 29n) & 0x5555555555555555n;
    value ^= (value << 17n) & 0x71d67fffeda60000n;
    value ^= (value << 37n) & 0xfff7eee000000000n;
    value ^= value >> 43n;
    for (let i = 0; i < 8 && offset + i < bytes.length; i++) {
      bytes[offset + i] ^= Number((value >> BigInt(i * 8)) & 255n);
    }
  }
}

function quarter(x: Uint32Array, a: number, b: number, c: number, d: number): void {
  const rot = (v: number, n: number): number => (v << n) | (v >>> (32 - n));
  x[a] += x[b]; x[d] = rot(x[d] ^ x[a], 16);
  x[c] += x[d]; x[b] = rot(x[b] ^ x[c], 12);
  x[a] += x[b]; x[d] = rot(x[d] ^ x[a], 8);
  x[c] += x[d]; x[b] = rot(x[b] ^ x[c], 7);
}

function shuffle(x: Uint32Array, rounds: number): void {
  for (let i = 0; i < rounds; i += 2) {
    quarter(x, 0, 4, 8, 12); quarter(x, 1, 5, 9, 13);
    quarter(x, 2, 6, 10, 14); quarter(x, 3, 7, 11, 15);
    quarter(x, 0, 5, 10, 15); quarter(x, 1, 6, 11, 12);
    quarter(x, 2, 7, 8, 13); quarter(x, 3, 4, 9, 14);
  }
}

function decryptChaCha(encrypted: Uint8Array, keyIv: Uint8Array): Uint8Array {
  let hash = ysmCityHash64(keyIv, RESOURCE_SEED);
  let rounds = 10 * Number(hash % 3n) + 10;
  const keyView = new DataView(keyIv.buffer, keyIv.byteOffset, keyIv.byteLength);
  const subkey = new Uint32Array(16);
  subkey.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) subkey[i + 4] = keyView.getUint32(i * 4, true);
  for (let i = 0; i < 4; i++) subkey[i + 12] = keyView.getUint32(32 + i * 4, true);
  shuffle(subkey, rounds);
  const state = new Uint32Array(16);
  state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  state.set([subkey[0], subkey[1], subkey[2], subkey[3], subkey[12], subkey[13], subkey[14], subkey[15]], 4);
  state[14] = keyView.getUint32(48, true);
  state[15] = keyView.getUint32(52, true);
  const output = new Uint8Array(encrypted.length);
  const work = new Uint32Array(16);
  let offset = 0;
  while (offset < output.length) {
    const chunkSize = Math.min(Number(((hash & 63n) | 64n) << 6n), output.length - offset);
    const end = offset + chunkSize;
    const start = offset;
    while (offset < end) {
      work.set(state);
      shuffle(work, rounds);
      for (let i = 0; i < 16; i++) work[i] += state[i];
      const blockSize = Math.min(64, end - offset);
      for (let i = 0; i < blockSize; i++) output[offset + i] = encrypted[offset + i] ^ ((work[i >>> 2] >>> ((i & 3) * 8)) & 255);
      state[12]++;
      if (state[12] === 0) state[13]++;
      offset += blockSize;
    }
    if (offset < output.length) {
      hash = ysmCityHash64(output.subarray(start, end), RESOURCE_SEED);
      rounds = 10 * Number(hash % 3n) + 10;
      const low = Number(hash & 0xffffffffn);
      const high = Number(hash >> 32n);
      for (let i = 4; i < 16; i++) state[i] ^= i % 2 === 0 ? low : high;
    }
  }
  return output;
}

function restoreZstd(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || view.getUint32(0, true) !== 0xfd2fb528) throw new Error('YSM: Invalid compressed payload.');
  const descriptor = bytes[4];
  bytes[4] &= 0xfb; // YSM does not store the standard frame checksum.
  const singleSegment = (descriptor & 32) !== 0;
  const dictSize = [0, 1, 2, 4][descriptor & 3];
  const contentSizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >>> 6];
  const sizeOffset = 5 + (singleSegment ? 0 : 1) + dictSize;
  let offset = sizeOffset + contentSizeBytes;
  if (offset > bytes.length) throw new Error('YSM: Truncated Zstandard header.');
  if (!singleSegment) {
    const windowBase = 2 ** (10 + (bytes[5] >>> 3));
    if (windowBase * (1 + (bytes[5] & 7) / 8) > MAX_PAYLOAD) throw new Error('YSM: Zstandard window exceeds 128 MiB.');
  }
  let contentSize = 0n;
  for (let i = 0; i < contentSizeBytes; i++) contentSize |= BigInt(bytes[sizeOffset + i]) << BigInt(i * 8);
  if (contentSizeBytes === 2) contentSize += 256n;
  if (contentSize > BigInt(MAX_PAYLOAD)) throw new Error('YSM: Decompressed payload exceeds 128 MiB.');
  while (offset + 3 <= bytes.length) {
    const b0 = bytes[offset];
    const last = b0 >>> 7;
    const type = [2, 1, 3, 0][(b0 >>> 5) & 3];
    const size = (((b0 & 31) << 16) | bytes[offset + 1] | (bytes[offset + 2] << 8)) ^ 0xd4e9;
    if (type === 3 || size > 131072) throw new Error('YSM: Invalid compressed block.');
    const header = last | (type << 1) | (size << 3);
    bytes[offset] = header & 255;
    bytes[offset + 1] = (header >>> 8) & 255;
    bytes[offset + 2] = header >>> 16;
    offset += 3 + (type === 1 ? 1 : size);
    if (offset > bytes.length) throw new Error('YSM: Truncated compressed block.');
    if (last) {
      const frame = bytes.subarray(0, offset);
      let output: Uint8Array;
      if (contentSizeBytes) {
        output = decompress(frame);
        if (output.length !== Number(contentSize)) throw new Error('YSM: Decompressed size does not match its header.');
      } else {
        const chunks: Uint8Array[] = [];
        let length = 0;
        new Decompress((chunk) => {
          length += chunk.length;
          if (length > MAX_PAYLOAD) throw new Error('YSM: Decompressed payload exceeds 128 MiB.');
          chunks.push(chunk.slice());
        }).push(frame, true);
        output = new Uint8Array(length);
        let position = 0;
        for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
      }
      if (output.length > MAX_PAYLOAD) throw new Error('YSM: Decompressed payload exceeds 128 MiB.');
      return output;
    }
  }
  throw new Error('YSM: Missing final compressed block.');
}

export function decryptYsgp(bytes: Uint8Array): Uint8Array {
  if (!isYsgpBytes(bytes)) throw new Error('YSM: Unrecognized YSGP signature.');
  if (bytes.length > MAX_PAYLOAD) throw new Error('YSM: Archive exceeds 128 MiB.');
  const headerEnd = bytes.indexOf(0);
  const tail = bytes.length - 64;
  if (headerEnd < 0 || headerEnd + 7 > tail) throw new Error('YSM: Truncated archive.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cryptoVersion = view.getUint32(headerEnd + 1, true);
  if (cryptoVersion !== 3) throw new Error(`YSM: Unsupported crypto version ${cryptoVersion}; expected 3.`);
  if (ysmCityHash64(bytes.subarray(0, bytes.length - 8), FILE_SEED) !== view.getBigUint64(bytes.length - 8, true)) {
    throw new Error('YSM: Archive checksum mismatch; the file may be corrupted.');
  }
  const keyIv = bytes.subarray(tail, tail + 56);
  const clear = decryptChaCha(bytes.subarray(headerEnd + 5, tail), keyIv);
  mt19937Xor(clear, ysmCityHash64(keyIv, KEY_SEED));
  const padding = (clear[0] | (clear[1] << 8)) & 1023;
  if (padding + 7 > clear.length) throw new Error('YSM: Invalid payload padding.');
  return restoreZstd(clear.subarray(padding + 2));
}
