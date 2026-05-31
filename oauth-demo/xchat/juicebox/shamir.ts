/**
 * juicebox/shamir.ts — Shamir's Secret Sharing with Lagrange interpolation
 * Port of: pkg/juiceboxgo/secretsharing/shamir.go
 */

import { ristretto255 } from '@noble/curves/ed25519.js';
import { Field } from '@noble/curves/abstract/modular.js';
import crypto from 'crypto';

const ORDER = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
const Fp = Field(ORDER);
const Point = ristretto255.Point;
type RistPoint = typeof Point.BASE;

export interface ScalarShare { index: number; secret: bigint; }
export interface PointShare { index: number; secret: RistPoint; }

/**
 * Split a scalar secret into n shares with threshold t.
 * Uses polynomial of degree (t-1) with secret as constant term.
 */
export function splitScalar(secret: bigint, indices: number[], threshold: number): ScalarShare[] {
  // Generate random polynomial coefficients (degree threshold-1)
  const coeffs: bigint[] = [secret];
  for (let i = 1; i < threshold; i++) {
    const randomBytes = new Uint8Array(64);
    crypto.getRandomValues(randomBytes);
    coeffs.push(Fp.create(bytesToBigIntLE(randomBytes)));
  }

  // Evaluate polynomial at each index
  return indices.map(idx => {
    const x = BigInt(idx);
    let y = 0n;
    let xPow = 1n;
    for (const coeff of coeffs) {
      y = Fp.add(y, Fp.mul(coeff, xPow));
      xPow = Fp.mul(xPow, x);
    }
    return { index: idx, secret: y };
  });
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

function lagrangeCoefficient(shares: { index: number }[], i: number): bigint {
  let numerator = 1n, denominator = 1n;
  const xi = BigInt(shares[i].index);
  for (let j = 0; j < shares.length; j++) {
    if (i === j) continue;
    const xj = BigInt(shares[j].index);
    numerator = Fp.mul(numerator, xj);
    denominator = Fp.mul(denominator, Fp.sub(xj, xi));
  }
  return Fp.mul(numerator, Fp.inv(denominator));
}

export function recoverScalar(shares: ScalarShare[]): bigint {
  let result = 0n;
  for (let i = 0; i < shares.length; i++) result = Fp.add(result, Fp.mul(shares[i].secret, lagrangeCoefficient(shares, i)));
  return result;
}

export function recoverPoint(shares: PointShare[]): RistPoint {
  let result = Point.ZERO;
  for (let i = 0; i < shares.length; i++) result = result.add(shares[i].secret.multiply(lagrangeCoefficient(shares, i)));
  return result;
}
