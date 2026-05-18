/**
 * juicebox/shamir.ts — Shamir's Secret Sharing with Lagrange interpolation
 * Port of: pkg/juiceboxgo/secretsharing/shamir.go
 */

import { ristretto255 } from '@noble/curves/ed25519.js';
import { Field } from '@noble/curves/abstract/modular.js';

const ORDER = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
const Fp = Field(ORDER);
const Point = ristretto255.Point;
type RistPoint = typeof Point.BASE;

export interface ScalarShare { index: number; secret: bigint; }
export interface PointShare { index: number; secret: RistPoint; }

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
