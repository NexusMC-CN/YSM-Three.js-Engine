/** YSM's CityHash64 variant. Adapted from OpenYSM (MIT); see THIRD_PARTY_NOTICES.md. */
const K0 = 0xe4986a230e5aaa17n;
const K1 = 0x91af10802cab25a5n;
const K2 = 0xaf29ce778879d9c7n;
const KMUL = 0xde0f6ee09bdbab91n;
const u64 = (value: bigint): bigint => BigInt.asUintN(64, value);
const rotate = (value: bigint, bits: bigint): bigint => {
  const x = u64(value);
  return u64((x >> bits) | (x << (64n - bits)));
};
const mix = (value: bigint): bigint => {
  const x = u64(value);
  return x ^ (x >> 47n);
};

function hash16(a: bigint, b: bigint, mul?: bigint): bigint {
  const multiplier = mul ?? KMUL;
  let x = mix(u64((u64(a) ^ u64(b)) * multiplier));
  // OpenYSM's two-argument hash uses the low word here; its three-argument
  // variant uses the high word. They are distinct algorithms.
  x = mix(u64((u64(mul === undefined ? a : b) ^ x) * multiplier));
  return u64(x * multiplier);
}

function reverse(value: bigint): bigint {
  let x = u64(value);
  let result = 0n;
  for (let i = 0; i < 8; i++, x >>= 8n) result = (result << 8n) | (x & 255n);
  return result;
}

export function ysmCityHash64(bytes: Uint8Array, seed: bigint): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  const length = BigInt(len);
  const fetch = (offset: number): bigint => view.getBigUint64(offset, true);
  const weak = (offset: number, seedA: bigint, seedB: bigint): [bigint, bigint] => {
    let a = u64(seedA + fetch(offset));
    let b = rotate(seedB + a + fetch(offset + 24), 21n);
    const c = a;
    a = u64(a + fetch(offset + 8) + fetch(offset + 16));
    b = u64(b + rotate(a, 44n));
    return [u64(a + fetch(offset + 24)), u64(b + c)];
  };

  let hash: bigint;
  const mul = u64(K2 + length * 2n);
  if (len <= 16) {
    if (len >= 8) {
      const a = u64(fetch(0) + K2);
      const b = fetch(len - 8);
      hash = hash16(u64(rotate(b, 37n) * mul + a), u64((rotate(a, 25n) + b) * mul), mul);
    } else if (len >= 4) {
      const a = BigInt(view.getUint32(0, true));
      hash = hash16(length + (a << 3n), BigInt(view.getUint32(len - 4, true)), mul);
    } else if (len > 0) {
      const y = BigInt(bytes[0] + (bytes[len >>> 1] << 8));
      const z = BigInt(len + (bytes[len - 1] << 2));
      hash = u64(mix(u64(y * K2) ^ u64(z * K0)) * K2);
    } else {
      hash = K2;
    }
  } else if (len <= 32) {
    const a = u64(fetch(0) * K1);
    const b = fetch(8);
    const c = u64(fetch(len - 8) * mul);
    const d = u64(fetch(len - 16) * K2);
    hash = hash16(rotate(a + b, 43n) + rotate(c, 30n) + d, a + rotate(b + K2, 18n) + c, mul);
  } else if (len <= 64) {
    let a = u64(fetch(0) * K2);
    let b = fetch(8);
    const c = fetch(len - 24);
    const d = fetch(len - 32);
    const e = u64(fetch(16) * K2);
    const f = u64(fetch(24) * 9n);
    const g = fetch(len - 8);
    const h = u64(fetch(len - 16) * mul);
    const u = u64(rotate(a + g, 43n) + (rotate(b, 30n) + c) * 9n);
    const v = u64((u64(a + g) ^ d) + f + 1n);
    const w = u64(reverse(u64((u + v) * mul)) + h);
    const x = u64(rotate(e + f, 42n) + c);
    const y = u64((reverse(u64((v + w) * mul)) + g) * mul);
    const z = u64(e + f + c);
    a = u64(reverse(u64((x + z) * mul + y)) + b);
    b = u64(mix(u64((z + a) * mul + d + h)) * mul);
    hash = u64(b + x);
  } else {
    let x = fetch(len - 40);
    let y = u64(fetch(len - 16) + fetch(len - 56));
    let z = hash16(fetch(len - 48) + length, fetch(len - 24));
    let [vLow, vHigh] = weak(len - 64, length, z);
    let [wLow, wHigh] = weak(len - 32, y + K1, x);
    x = u64(x * K1 + fetch(0));
    const end = Math.floor((len - 1) / 64) * 64;
    for (let offset = 0; offset < end; offset += 64) {
      x = u64(rotate(x + y + vLow + fetch(offset + 8), 37n) * K1) ^ wHigh;
      y = u64(rotate(y + vHigh + fetch(offset + 48), 42n) * K1 + vLow + fetch(offset + 40));
      z = u64(rotate(z + wLow, 33n) * K1);
      [vLow, vHigh] = weak(offset, vHigh * K1, x + wLow);
      [wLow, wHigh] = weak(offset + 32, z + wHigh, y + fetch(offset + 16));
      [x, z] = [z, x];
    }
    hash = hash16(hash16(vLow, wLow) + mix(y) * K1 + z, hash16(vHigh, wHigh) + x);
  }
  return hash16(u64(hash - K2), seed);
}
