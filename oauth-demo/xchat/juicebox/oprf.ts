/**
 * juicebox/oprf.ts — Oblivious Pseudorandom Function for Juicebox
 * Port of: pkg/juiceboxgo/oprf/oprf.go + dleq.go
 */

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { Field } from '@noble/curves/abstract/modular.js';
import { sha512 } from '@noble/hashes/sha2.js';
import crypto from 'crypto';

const ORDER = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
const Fp = Field(ORDER);
const Point = ristretto255.Point;

/** DeriveDalek: SHA-512(input) → map to ristretto255 point (matches Rust's hash_from_bytes::<Sha512>) */
function hashToPoint(input: Uint8Array) {
  return ristretto255_hasher.deriveToCurve(sha512(input));
}

/** 64-byte OPRF output */
export type OPRFOutput = Uint8Array;

export interface OPRFKeyPair {
  privateKey: Uint8Array;  // 32-byte scalar
  publicKey: Uint8Array;   // 32-byte ristretto255 point
}

/** Generate a random OPRF key pair for registration */
export function generateOPRFKeyPair(): OPRFKeyPair {
  const randomBytes = crypto.randomBytes(64);
  const scalar = Fp.create(bytesToBigInt(randomBytes));
  const scalarBytes = bigIntToBytes32LE(scalar);
  const publicPoint = Point.BASE.multiply(scalar);
  return { privateKey: scalarBytes, publicKey: publicPoint.toBytes() };
}

/** Evaluate OPRF server-side: output = input^privateKey */
export function oprfEvaluate(input: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const scalar = Fp.create(bytesToBigInt(privateKey));
  const inputPoint = Point.fromHex(toHex(input));
  return inputPoint.multiply(scalar).toBytes();
}

function bigIntToBytes32LE(n: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let val = n;
  for (let i = 0; i < 32; i++) { bytes[i] = Number(val & 0xFFn); val >>= 8n; }
  return bytes;
}

export interface BlindingState {
  blindingFactor: bigint;
  blindedInput: Uint8Array;
}

export function oprfStart(input: Uint8Array): BlindingState {
  const inputPoint = hashToPoint(input);
  const randomBytes = crypto.randomBytes(64);
  const blindingFactor = Fp.create(bytesToBigInt(randomBytes));
  const blindedPoint = inputPoint.multiply(blindingFactor);

  return { blindingFactor, blindedInput: blindedPoint.toBytes() };
}

export function oprfFinalize(input: Uint8Array, blindingFactor: bigint, blindedOutput: Uint8Array): OPRFOutput {
  const outputPoint = Point.fromHex(toHex(blindedOutput));
  const invFactor = Fp.inv(blindingFactor);
  const result = outputPoint.multiply(invFactor);

  const h = sha512.create();
  h.update(new TextEncoder().encode('Juicebox_OPRF_2023_1;'));
  h.update(input);
  h.update(result.toBytes());
  return h.digest();
}

export function verifyDLEQProof(
  blindedInput: Uint8Array, blindedOutput: Uint8Array, publicKey: Uint8Array,
  proofC: Uint8Array, proofBetaZ: Uint8Array,
): boolean {
  const u = Point.fromHex(toHex(blindedInput));
  const w = Point.fromHex(toHex(blindedOutput));
  const v = Point.fromHex(toHex(publicKey));
  const c = Fp.create(bytesToBigInt(proofC));
  const betaZ = Fp.create(bytesToBigInt(proofBetaZ));

  const vT = Point.BASE.multiply(betaZ).add(v.multiply(c).negate());
  const wT = u.multiply(betaZ).add(w.multiply(c).negate());

  const h = sha512.create();
  h.update(new TextEncoder().encode('Juicebox_DLEQ_2023_1;'));
  h.update(blindedInput);
  h.update(publicKey);
  h.update(blindedOutput);
  h.update(vT.toBytes());
  h.update(wT.toBytes());
  const recomputedC = Fp.create(bytesToBigInt(h.digest()));

  return Fp.eql(c, recomputedC);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
