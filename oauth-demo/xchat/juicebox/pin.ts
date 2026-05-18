/**
 * juicebox/pin.ts — PIN hashing for Juicebox (Argon2id)
 * Port of: pkg/juiceboxgo/pin/hash.go
 */

import { argon2id } from 'hash-wasm';

export type PinHashingMode = 'Standard2019' | 'FastInsecure';

export interface PinHashResult {
  accessKey: Uint8Array;        // 32 bytes — OPRF input
  encryptionKeySeed: Uint8Array; // 32 bytes — encryption key derivation
}

/**
 * Hash PIN using Argon2id.
 * Salt: BE4(len(version)) || version || BE4(len(userInfo)) || userInfo
 */
export async function hashPIN(
  pin: Uint8Array,
  mode: PinHashingMode,
  version: Uint8Array, // 16 bytes
  userInfo: Uint8Array,
): Promise<PinHashResult> {
  let timeCost: number, memoryCost: number, parallelism: number;

  if (mode === 'Standard2019') {
    memoryCost = 16 * 1024; // 16 MiB
    timeCost = 32;
    parallelism = 1;
  } else {
    memoryCost = 8;
    timeCost = 1;
    parallelism = 1;
  }

  // Construct salt: BE4(len(version)) || version || BE4(len(userInfo)) || userInfo
  const salt = new Uint8Array(4 + version.length + 4 + userInfo.length);
  const dv = new DataView(salt.buffer);
  dv.setUint32(0, version.length);
  salt.set(version, 4);
  dv.setUint32(4 + version.length, userInfo.length);
  salt.set(userInfo, 4 + version.length + 4);

  const hash = await argon2id({
    password: pin,
    salt,
    iterations: timeCost,
    memorySize: memoryCost,
    parallelism,
    hashLength: 64,
    outputType: 'binary',
  });

  return {
    accessKey: hash.slice(0, 32),
    encryptionKeySeed: hash.slice(32, 64),
  };
}
