/**
 * juicebox/noise.ts — Noise_NK_25519_ChaChaPoly_BLAKE2s
 * Port of: pkg/juiceboxgo/noise/client.go
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import crypto from 'crypto';

const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_BLAKE2s';

function mixHash(h: Uint8Array, data: Uint8Array): Uint8Array {
  const hasher = blake2s.create({ dkLen: 32 });
  hasher.update(h);
  hasher.update(data);
  return hasher.digest();
}

function hkdfPair(salt: Uint8Array, ikm: Uint8Array | null): [Uint8Array, Uint8Array] {
  const out = hkdf(blake2s, ikm ?? new Uint8Array(0), salt, undefined, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

class CipherState {
  private nonce = 0;
  constructor(private key: Uint8Array) {}

  private nextNonce(): Uint8Array {
    const nonce = new Uint8Array(12);
    new DataView(nonce.buffer).setUint32(4, this.nonce & 0xFFFFFFFF, true);
    this.nonce++;
    return nonce;
  }

  encrypt(plaintext: Uint8Array, ad?: Uint8Array): Uint8Array {
    return chacha20poly1305(this.key, this.nextNonce(), ad).encrypt(plaintext);
  }

  decrypt(ciphertext: Uint8Array, ad?: Uint8Array): Uint8Array {
    return chacha20poly1305(this.key, this.nextNonce(), ad).decrypt(ciphertext);
  }
}

export class NoiseTransport {
  constructor(private inbound: CipherState, private outbound: CipherState) {}
  encrypt(plaintext: Uint8Array): Uint8Array { return this.outbound.encrypt(plaintext); }
  decrypt(ciphertext: Uint8Array): Uint8Array { return this.inbound.decrypt(ciphertext); }
}

export interface HandshakeRequest { clientEphemeralPublic: Uint8Array; payloadCiphertext: Uint8Array; }
export interface HandshakeResponse { serverEphemeralPublic: Uint8Array; payloadCiphertext: Uint8Array; }
export interface HandshakeState { clientEphemeralSecret: Uint8Array; h: Uint8Array; ck: Uint8Array; }

export function noiseStart(serverStaticPublic: Uint8Array, payload: Uint8Array): { state: HandshakeState; request: HandshakeRequest } {
  const clientEphemeralSecret = crypto.randomBytes(32);
  const clientEphemeralPublic = x25519.getPublicKey(clientEphemeralSecret);

  let h = blake2s(new TextEncoder().encode(PROTOCOL_NAME), { dkLen: 32 });
  let ck = Uint8Array.from(h);

  h = mixHash(h, new Uint8Array(0));
  h = mixHash(h, serverStaticPublic);
  h = mixHash(h, clientEphemeralPublic);

  const shared = x25519.getSharedSecret(clientEphemeralSecret, serverStaticPublic);
  const [newCk, cipherKey] = hkdfPair(ck, shared);
  ck = newCk;

  const payloadCiphertext = new CipherState(cipherKey).encrypt(payload, h);
  h = mixHash(h, payloadCiphertext);

  return { state: { clientEphemeralSecret, h, ck }, request: { clientEphemeralPublic, payloadCiphertext } };
}

export function noiseFinish(state: HandshakeState, response: HandshakeResponse): { transport: NoiseTransport; payload: Uint8Array } {
  let { h, ck } = state;

  h = mixHash(h, response.serverEphemeralPublic);
  const shared = x25519.getSharedSecret(state.clientEphemeralSecret, response.serverEphemeralPublic);
  const [newCk, cipherKey] = hkdfPair(ck, shared);
  ck = newCk;

  const payload = new CipherState(cipherKey).decrypt(response.payloadCiphertext, h);
  const [k1, k2] = hkdfPair(ck, null);

  return { transport: new NoiseTransport(new CipherState(k2), new CipherState(k1)), payload };
}
