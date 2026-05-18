/**
 * juicebox/config.ts — Configuration parsing for Juicebox
 * Port of: pkg/juiceboxgo/config.go + types.go
 */

import type { PinHashingMode } from './pin.js';

export interface Realm {
  id: Uint8Array;       // 16 bytes
  address: string;      // HTTP(S) URL
  publicKey?: Uint8Array; // 32 bytes (hardware realm) or undefined (software realm)
}

export interface JuiceboxConfig {
  realms: Realm[];
  registerThreshold: number;
  recoverThreshold: number;
  pinHashingMode: PinHashingMode;
}

/**
 * Parse Juicebox configuration from the JSON returned by GET /2/users/{id}/public_keys.
 * Handles both the raw `juicebox_config` format and the normalized `sdk_config` format.
 */
export function parseConfig(json: any): JuiceboxConfig {
  // Handle the normalized format from xchat-bot-python (sdk_config + tokens)
  let raw = json;
  if (json.sdk_config && typeof json.sdk_config === 'string') {
    raw = JSON.parse(json.sdk_config);
  }

  const realms: Realm[] = (raw.realms || []).map((r: any) => ({
    id: hexToBytes(r.id),
    address: r.address,
    publicKey: r.public_key ? hexToBytes(r.public_key) : undefined,
  }));

  // Sort realms by ID
  realms.sort((a, b) => compareBytes(a.id, b.id));

  const config: JuiceboxConfig = {
    realms,
    registerThreshold: raw.register_threshold ?? realms.length,
    recoverThreshold: raw.recover_threshold ?? Math.ceil(realms.length / 2) + 1,
    pinHashingMode: raw.pin_hashing_mode ?? 'Standard2019',
  };

  if (config.realms.length === 0) throw new Error('configuration must contain at least one realm');
  if (config.recoverThreshold > config.realms.length) throw new Error('recover_threshold exceeds realm count');

  return config;
}

/** Get the 1-based share index for a realm by ID. */
export function shareIndex(config: JuiceboxConfig, realmId: Uint8Array): number {
  for (let i = 0; i < config.realms.length; i++) {
    if (compareBytes(config.realms[i].id, realmId) === 0) return i + 1;
  }
  throw new Error('realm not found in config');
}

/** Extract auth tokens from the normalized format. */
export function extractAuthTokens(json: any): Map<string, string> {
  const tokens = new Map<string, string>();
  if (json.tokens && typeof json.tokens === 'object') {
    for (const [key, value] of Object.entries(json.tokens)) {
      tokens.set(key, value as string);
    }
  }
  if (json.token_map && Array.isArray(json.token_map)) {
    for (const entry of json.token_map) {
      if (entry.key && entry.value?.token) {
        tokens.set(entry.key, entry.value.token);
      }
    }
  }
  return tokens;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}
