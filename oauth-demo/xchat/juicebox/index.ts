/**
 * juicebox/index.ts — Juicebox PIN-based key recovery for X Chat
 *
 * Port of the Go implementation at:
 *   /Users/dcherkas/projects/opensource/twitter/pkg/juiceboxgo/
 *
 * Usage:
 *   import { recover } from './juicebox/client.js';
 *   const secret = await recover(pin, juiceboxConfigJson, userId);
 */

export { recover } from './client.js';
export { hashPIN } from './pin.js';
export { parseConfig, extractAuthTokens } from './config.js';
export type { JuiceboxConfig, Realm } from './config.js';
