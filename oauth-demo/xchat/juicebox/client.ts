/**
 * juicebox/client.ts — Juicebox recovery client
 * Port of: pkg/juiceboxgo/client.go (Recover method only — we don't need Register/Delete)
 */

import { ristretto255, ed25519 } from '@noble/curves/ed25519.js';
import crypto from 'crypto';
import { hashPIN } from './pin.js';
import { oprfStart, oprfFinalize, verifyDLEQProof, generateOPRFKeyPair, oprfEvaluate } from './oprf.js';
import { recoverScalar, recoverPoint, splitScalar, type ScalarShare, type PointShare } from './shamir.js';
import { deriveUnlockKeyAndCommitment, deriveUnlockKeyTag, deriveEncryptionKey, decryptSecret, encryptSecret, deriveEncryptedUserSecretCommitment } from './crypto.js';
import { parseConfig, shareIndex, extractAuthTokens, type JuiceboxConfig } from './config.js';
import { RealmClient } from './realm.js';
import type { JuiceboxCallLoggerInterface } from '../../storage.js';


export interface RecoverResult {
  secret: Uint8Array;
}

/**
 * Register a PIN-protected secret with Juicebox realms.
 *
 * @param pin - The user's PIN (UTF-8 encoded)
 * @param secret - The 64-byte secret to protect (decrypt_key || signing_key)
 * @param juiceboxConfigJson - JSON with sdk_config + tokens from AddXChatPublicKeyMutation response
 * @param userId - The user ID
 * @param logger - Optional logger
 */
export async function register(pin: string, secret: Uint8Array, juiceboxConfigJson: string, userId: string, logger?: JuiceboxCallLoggerInterface): Promise<void> {
  const configRaw = JSON.parse(juiceboxConfigJson);
  const config = parseConfig(configRaw);
  const authTokens = extractAuthTokens(configRaw);

  const realmClients = config.realms.map(r => {
    const realmIdHex = bytesToHex(r.id);
    const token = authTokens.get(realmIdHex) ?? '';
    return new RealmClient(r, token, logger);
  });

  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[32mINFO\x1b[0m  \x1b[36m[juicebox]\x1b[0m starting registration (${config.realms.length} realms, threshold=${config.registerThreshold})`);

  // Hash PIN (same as recovery)
  const pinBytes = new TextEncoder().encode(pin);
  const userInfo = new Uint8Array(0);
  // Use a fresh version for registration
  const version = new Uint8Array(16);
  crypto.randomBytes(16).copy(Buffer.from(version.buffer));
  const { accessKey, encryptionKeySeed } = await hashPIN(pinBytes, config.pinHashingMode, version, userInfo);

  // Generate OPRF key pair for each realm and compute unlock key
  const oprfKeys = config.realms.map(() => generateOPRFKeyPair());

  // Compute OPRF output by evaluating locally (we know the private key)
  // For registration, we simulate the OPRF: hash input to point, multiply by private key, then finalize
  const { blindingFactor, blindedInput } = oprfStart(accessKey);

  // Evaluate OPRF for each realm and combine via Lagrange interpolation
  const pointShares: PointShare[] = config.realms.map((r, i) => {
    const evaluated = oprfEvaluate(blindedInput, oprfKeys[i].privateKey);
    return {
      index: shareIndex(config, r.id),
      secret: ristretto255.Point.fromHex(bytesToHex(evaluated)),
    };
  });
  const combinedPoint = recoverPoint(pointShares.slice(0, config.recoverThreshold));
  const oprfOutput = oprfFinalize(accessKey, blindingFactor, combinedPoint.toBytes());

  // Derive unlock key and commitment
  const { unlockKey, commitment: unlockKeyCommitment } = deriveUnlockKeyAndCommitment(oprfOutput);

  // Split encryption key scalar into shares
  const randomScalar = bytesToBigIntLE(crypto.randomBytes(32));
  const indices = config.realms.map(r => shareIndex(config, r.id));
  const scalarShares = splitScalar(randomScalar, indices, config.recoverThreshold);

  // Derive encryption key from combined scalar
  const combinedScalarBytes = bigIntToBytes32LE(randomScalar);
  const encryptionKey = deriveEncryptionKey(encryptionKeySeed, combinedScalarBytes);

  // Encrypt the secret
  const encryptedSecret = encryptSecret(secret, encryptionKey);

  // Phase 1: Register1 on all realms
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 1: sending Register1 to all realms`);
  const phase1Results = await Promise.allSettled(
    realmClients.map(c => c.makeRequest({ register1: true }))
  );
  for (let i = 0; i < phase1Results.length; i++) {
    const r = phase1Results[i];
    if (r.status === 'rejected') throw new Error(`Register1 failed on realm ${i}: ${r.reason?.message}`);
  }

  // Phase 2: Register2 on all realms
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 2: sending Register2 to all realms`);
  const phase2Results = await Promise.allSettled(
    config.realms.map((r, i) => {
      const scalarShareBytes = bigIntToBytes32LE(scalarShares[i].secret);
      const unlockKeyTag = deriveUnlockKeyTag(unlockKey, r.id);
      const encSecretCommitment = deriveEncryptedUserSecretCommitment(unlockKey, r.id, scalarShareBytes, encryptedSecret);

      return realmClients[i].makeRequest({
        register2: {
          version,
          oprfPrivateKey: oprfKeys[i].privateKey,
          oprfPublicKey: oprfKeys[i].publicKey,
          oprfVerifyingKey: oprfKeys[i].publicKey, // For now, same as public key
          unlockKeyCommitment: unlockKeyCommitment,
          unlockKeyTag,
          encryptionKeyScalarShare: scalarShareBytes,
          encryptedSecret,
          encryptedSecretCommitment: encSecretCommitment,
          numGuesses: configRaw.max_guess_count ?? 20,
        },
      });
    })
  );

  for (let i = 0; i < phase2Results.length; i++) {
    const r = phase2Results[i];
    if (r.status === 'rejected') throw new Error(`Register2 failed on realm ${i}: ${r.reason?.message}`);
  }

  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[32mINFO\x1b[0m  \x1b[36m[juicebox]\x1b[0m registration complete (secret stored on ${config.realms.length} realms)`);
}

/**
 * Recover a PIN-protected secret from Juicebox realms.
 *
 * @param pin - The user's PIN (UTF-8 encoded)
 * @param juiceboxConfigJson - JSON from GET /2/users/{id}/public_keys → juicebox_config
 * @param userId - The user ID (used as userInfo for Argon2 salt)
 * @param logger - Optional logger for storing request details
 */
export async function recover(pin: string, juiceboxConfigJson: string, userId: string, logger?: JuiceboxCallLoggerInterface): Promise<Uint8Array> {
  const configRaw = JSON.parse(juiceboxConfigJson);
  const config = parseConfig(configRaw);
  const authTokens = extractAuthTokens(configRaw);

  const realmClients = config.realms.map(r => {
    const realmIdHex = bytesToHex(r.id);
    const token = authTokens.get(realmIdHex) ?? '';
    return new RealmClient(r, token, logger);
  });

  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[32mINFO\x1b[0m  \x1b[36m[juicebox]\x1b[0m starting recovery (${config.realms.length} realms, threshold=${config.recoverThreshold})`);

  // Phase 1: Query version
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 1: querying version from realms`);
  const { version, realmIndices } = await recoverPhase1(config, realmClients);
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 1: got version from ${realmIndices.length} realms`);

  // Hash PIN
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m hashing PIN with Argon2id (mode=${config.pinHashingMode})`);
  const pinBytes = new TextEncoder().encode(pin);
  const userInfo = new Uint8Array(0);
  const { accessKey, encryptionKeySeed } = await hashPIN(pinBytes, config.pinHashingMode, version, userInfo);
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m PIN hashed successfully`);

  // Phase 2: OPRF evaluation
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 2: OPRF evaluation`);
  const unlockKey = await recoverPhase2(config, realmClients, realmIndices, version, accessKey);
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[32mINFO\x1b[0m  \x1b[36m[juicebox]\x1b[0m phase 2: PIN verified, unlock key derived`);

  // Phase 3: Retrieve and decrypt secret
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[36m[juicebox]\x1b[0m phase 3: retrieving encrypted secret`);
  const secret = await recoverPhase3(config, realmClients, realmIndices, version, unlockKey, encryptionKeySeed);
  console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[32mINFO\x1b[0m  \x1b[36m[juicebox]\x1b[0m phase 3: secret recovered (${secret.length} bytes)`);
  return secret;
}

async function recoverPhase1(config: JuiceboxConfig, clients: RealmClient[]): Promise<{ version: Uint8Array; realmIndices: number[] }> {
  const results = await Promise.allSettled(
    clients.map(c => c.makeRequest({ recover1: true }))
  );

  const versions = new Map<string, { version: Uint8Array; indices: number[] }>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[33mWARN\x1b[0m  \x1b[36m[juicebox]\x1b[0m phase 1: realm ${i} failed: ${r.reason?.message || r.reason}`);
      continue;
    }
    if (!r.value.Recover1?.Ok) {
      console.log(`\x1b[2m${new Date().toISOString()}\x1b[0m \x1b[33mWARN\x1b[0m  \x1b[36m[juicebox]\x1b[0m phase 1: realm ${i} no Ok: ${JSON.stringify(r.value.Recover1)}`);
      continue;
    }
    const v = r.value.Recover1.Ok.version;
    const key = bytesToHex(v);
    const entry = versions.get(key) ?? { version: v, indices: [] };
    entry.indices.push(i);
    versions.set(key, entry);
  }

  for (const [, entry] of versions) {
    if (entry.indices.length >= config.recoverThreshold) {
      return { version: entry.version, realmIndices: entry.indices };
    }
  }
  throw new Error('Could not reach threshold agreement on version');
}

async function recoverPhase2(
  config: JuiceboxConfig,
  clients: RealmClient[],
  realmIndices: number[],
  version: Uint8Array,
  accessKey: Uint8Array,
): Promise<Uint8Array> {
  const { blindingFactor, blindedInput } = oprfStart(accessKey);

  const results = await Promise.allSettled(
    realmIndices.map(i => clients[i].makeRequest({
      recover2: { version, oprfBlindedInput: Buffer.from(blindedInput) },
    }))
  );

  interface Phase2Ok {
    realmIdx: number;
    blindedResult: Uint8Array;
    commitment: Uint8Array;
    guessesRemaining: number;
  }

  const successes: Phase2Ok[] = [];
  for (let j = 0; j < results.length; j++) {
    const r = results[j];
    if (r.status !== 'fulfilled' || !r.value.Recover2?.Ok) continue;
    const ok = r.value.Recover2.Ok;

    // Verify Ed25519 signature on OPRF public key
    const sigMsg = buildOprfSignatureMessage(config.realms[realmIndices[j]].id, ok.oprf_signed_public_key.public_key);
    const sigValid = ed25519.verify(ok.oprf_signed_public_key.signature, sigMsg, ok.oprf_signed_public_key.verifying_key);
    if (!sigValid) continue;

    // Verify DLEQ proof
    const proofValid = verifyDLEQProof(
      blindedInput, ok.oprf_blinded_result, ok.oprf_signed_public_key.public_key,
      ok.oprf_proof.c, ok.oprf_proof.beta_z,
    );
    if (!proofValid) continue;

    successes.push({
      realmIdx: realmIndices[j],
      blindedResult: ok.oprf_blinded_result,
      commitment: ok.unlock_key_commitment,
      guessesRemaining: ok.num_guesses - ok.guess_count,
    });
  }

  if (successes.length < config.recoverThreshold) {
    throw new Error('Could not reach threshold for OPRF evaluation');
  }

  // Group by commitment, pick group with threshold
  const groups = new Map<string, Phase2Ok[]>();
  for (const s of successes) {
    const key = bytesToHex(s.commitment);
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }

  let selected: Phase2Ok[] | null = null;
  let expectedCommitment: Uint8Array | null = null;
  for (const [, group] of groups) {
    if (group.length >= config.recoverThreshold) {
      selected = group;
      expectedCommitment = group[0].commitment;
      break;
    }
  }
  if (!selected || !expectedCommitment) throw new Error('No commitment group reached threshold');

  const pointShares: PointShare[] = selected.map(s => ({
    index: shareIndex(config, config.realms[s.realmIdx].id),
    secret: ristretto255.Point.fromHex(bytesToHex(s.blindedResult)),
  }));
  const combinedPoint = recoverPoint(pointShares);

  // Finalize OPRF
  const oprfOutput = oprfFinalize(accessKey, blindingFactor, combinedPoint.toBytes());

  // Derive unlock key and verify commitment
  const { unlockKey, commitment } = deriveUnlockKeyAndCommitment(oprfOutput);
  if (!constantTimeEqual(commitment, expectedCommitment)) {
    const minGuesses = Math.min(...selected.map(s => s.guessesRemaining));
    throw new Error(`Invalid PIN (${minGuesses} guesses remaining)`);
  }

  return unlockKey;
}

async function recoverPhase3(
  config: JuiceboxConfig,
  clients: RealmClient[],
  realmIndices: number[],
  version: Uint8Array,
  unlockKey: Uint8Array,
  encryptionKeySeed: Uint8Array,
): Promise<Uint8Array> {
  const results = await Promise.allSettled(
    realmIndices.map(i => {
      const tag = deriveUnlockKeyTag(unlockKey, config.realms[i].id);
      return clients[i].makeRequest({ recover3: { version, unlockKeyTag: tag } });
    })
  );

  interface Phase3Ok {
    realmIdx: number;
    scalarShare: Uint8Array;
    encryptedSecret: Uint8Array;
    commitment: Uint8Array;
  }

  const successes: Phase3Ok[] = [];
  for (let j = 0; j < results.length; j++) {
    const r = results[j];
    if (r.status !== 'fulfilled' || !r.value.Recover3?.Ok) continue;
    const ok = r.value.Recover3.Ok;

    // Verify commitment
    const ourCommitment = deriveEncryptedUserSecretCommitment(
      unlockKey, config.realms[realmIndices[j]].id, ok.encryption_key_scalar_share, ok.encrypted_secret,
    );
    if (!constantTimeEqual(ourCommitment, ok.encrypted_secret_commitment)) continue;

    successes.push({
      realmIdx: realmIndices[j],
      scalarShare: ok.encryption_key_scalar_share,
      encryptedSecret: ok.encrypted_secret,
      commitment: ok.encrypted_secret_commitment,
    });
  }

  if (successes.length < config.recoverThreshold) {
    throw new Error('Could not reach threshold for secret recovery');
  }

  // Group by encrypted secret
  const groups = new Map<string, Phase3Ok[]>();
  for (const s of successes) {
    const key = bytesToHex(s.encryptedSecret);
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }

  let selected: Phase3Ok[] | null = null;
  for (const [, group] of groups) {
    if (group.length >= config.recoverThreshold) { selected = group; break; }
  }
  if (!selected) throw new Error('No encrypted secret group reached threshold');

  // Combine scalar shares via Lagrange interpolation
  const scalarShares: ScalarShare[] = selected.map(s => ({
    index: shareIndex(config, config.realms[s.realmIdx].id),
    secret: bytesToBigIntLE(s.scalarShare),
  }));
  const combinedScalar = recoverScalar(scalarShares);

  // Derive encryption key
  const scalarBytes = bigIntToBytes32LE(combinedScalar);
  const encryptionKey = deriveEncryptionKey(encryptionKeySeed, scalarBytes);

  // Decrypt secret
  return decryptSecret(selected[0].encryptedSecret, encryptionKey);
}

// --- Helpers ---

function buildOprfSignatureMessage(realmId: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const msg = new Uint8Array(2 + realmId.length + 2 + publicKey.length);
  const dv = new DataView(msg.buffer);
  dv.setUint16(0, realmId.length);
  msg.set(realmId, 2);
  dv.setUint16(2 + realmId.length, publicKey.length);
  msg.set(publicKey, 2 + realmId.length + 2);
  return msg;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

function bigIntToBytes32LE(n: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { bytes[i] = Number(n & 0xFFn); n >>= 8n; }
  return bytes;
}
