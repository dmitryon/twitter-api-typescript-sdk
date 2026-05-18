/**
 * juicebox/crypto.ts — Cryptographic utilities for Juicebox
 * Port of: pkg/juiceboxgo/crypto/encrypt.go
 */

import { sha512 } from '@noble/hashes/sha2.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import type { OPRFOutput } from './oprf.js';

const MAX_USER_SECRET_LENGTH = 128;

export function deriveUnlockKeyAndCommitment(oprfOutput: OPRFOutput): { unlockKey: Uint8Array; commitment: Uint8Array } {
  const digest = sha512(oprfOutput);
  return { commitment: digest.slice(0, 32), unlockKey: digest.slice(32, 64) };
}

export function deriveUnlockKeyTag(unlockKey: Uint8Array, realmId: Uint8Array): Uint8Array {
  const h = blake2s.create({ key: unlockKey, dkLen: 16 });
  writeLengthPrefixed(h, new TextEncoder().encode('Unlock Key Tag'));
  writeLengthPrefixed(h, realmId);
  return h.digest();
}

export function deriveEncryptionKey(seed: Uint8Array, scalarBytes: Uint8Array): Uint8Array {
  const h = blake2s.create({ key: seed, dkLen: 32 });
  writeLengthPrefixed(h, new TextEncoder().encode('User Secret Encryption Key'));
  writeLengthPrefixed(h, scalarBytes);
  return h.digest();
}

export function decryptSecret(encryptedSecret: Uint8Array, encryptionKey: Uint8Array): Uint8Array {
  const cipher = chacha20poly1305(encryptionKey, new Uint8Array(12));
  const padded = cipher.decrypt(encryptedSecret);
  if (padded.length < 1) throw new Error('decryption failed');
  const length = padded[0];
  if (length > padded.length - 1 || length > MAX_USER_SECRET_LENGTH) throw new Error('decryption failed: invalid length');
  return padded.slice(1, 1 + length);
}

export function deriveEncryptedUserSecretCommitment(unlockKey: Uint8Array, realmId: Uint8Array, scalarShareBytes: Uint8Array, encryptedSecret: Uint8Array): Uint8Array {
  const h = blake2s.create({ key: unlockKey, dkLen: 16 });
  writeLengthPrefixed(h, new TextEncoder().encode('Encrypted User Secret Commitment'));
  writeLengthPrefixed(h, realmId);
  writeLengthPrefixed(h, scalarShareBytes);
  writeLengthPrefixed(h, encryptedSecret);
  return h.digest();
}

function writeLengthPrefixed(h: { update(data: Uint8Array): void }, data: Uint8Array) {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, data.length);
  h.update(lenBuf);
  h.update(data);
}
