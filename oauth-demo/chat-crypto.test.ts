/**
 * Tests for chat-crypto.ts
 *
 * Run with: npx ts-node --esm chat-crypto.test.ts
 * Or add to jest once ESM jest config is set up.
 */

import { Chat } from './chat-crypto.js';
import crypto from 'crypto';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
console.log('\nKey generation');
const keys = Chat.generateKeyPair();
assert(Buffer.from(keys.x25519PrivateKey, 'base64').length === 32, 'X25519 private key is 32 bytes');
assert(Buffer.from(keys.x25519PublicKey, 'base64').length === 32, 'X25519 public key is 32 bytes');
assert(Buffer.from(keys.ed25519PrivateKey, 'base64').length === 32, 'Ed25519 private key is 32 bytes');
assert(Buffer.from(keys.ed25519PublicKey, 'base64').length === 32, 'Ed25519 public key is 32 bytes');

// ---------------------------------------------------------------------------
// Conversation key generation and ECIES wrap/unwrap
// ---------------------------------------------------------------------------
console.log('\nConversation key wrap/unwrap (ECIES: X25519 + HKDF-SHA256 + AES-256-GCM)');
const convKey = Chat.generateConversationKey();
assert(Buffer.from(convKey, 'base64').length === 32, 'Conversation key is 32 bytes');

const wrapped = Chat.wrapConversationKey(convKey, keys.x25519PublicKey);
assert(wrapped !== convKey, 'Wrapped key differs from plaintext key');

const chat = new Chat();
chat.importKeys(JSON.stringify({
  x25519: keys.x25519PrivateKey,
  ed25519: keys.ed25519PrivateKey,
  ed25519_pub: keys.ed25519PublicKey,
}));
const unwrapped = chat.decryptConversationKey(wrapped);
assert(unwrapped === convKey, 'Unwrapped key matches original');

// ---------------------------------------------------------------------------
// importKeys / exportKeys roundtrip
// ---------------------------------------------------------------------------
console.log('\nimportKeys / exportKeys');
const exported = chat.exportKeys();
const chat2 = new Chat();
chat2.importKeys(exported);
const unwrapped2 = chat2.decryptConversationKey(wrapped);
assert(unwrapped2 === convKey, 'Keys survive export/import roundtrip');

// ---------------------------------------------------------------------------
// encryptMessageForApi / decryptEvent roundtrip
// ---------------------------------------------------------------------------
console.log('\nencryptMessageForApi / decryptEvent roundtrip');
const messageId = crypto.randomUUID();
const senderId = '123456789';
const conversationId = '123456789-987654321';
const text = 'Hello, XChat!';
const keyVersion = '1';
const signingKeyVersion = '1';

const payload = chat.encryptMessageForApi(
  messageId, senderId, conversationId,
  wrapped, text, keyVersion, signingKeyVersion,
);

assert(typeof payload.encrypted_content === 'string' && payload.encrypted_content.length > 0, 'encrypted_content is non-empty base64');
assert(typeof payload.encoded_event_signature === 'string' && payload.encoded_event_signature.length > 0, 'encoded_event_signature is non-empty base64');
assert(payload.encrypted_content !== Buffer.from(text).toString('base64'), 'encrypted_content is not plaintext');

// Decrypt and verify
const decrypted = chat.decryptEvent(payload.encrypted_content, wrapped);
assert(decrypted.type === 'Message', `decrypted event type is Message (got: ${decrypted.type})`);
if (decrypted.type === 'Message') {
  assert(decrypted.content.text === text, `decrypted text matches: "${decrypted.content.text}"`);
  assert(decrypted.message_id === messageId, 'decrypted message_id matches');
  assert(decrypted.sender_id === senderId, 'decrypted sender_id matches');
  assert(decrypted.conversation_id === conversationId, 'decrypted conversation_id matches');
}

// ---------------------------------------------------------------------------
// Different keys cannot decrypt each other's messages
// ---------------------------------------------------------------------------
console.log('\nIsolation: different keys cannot decrypt');
const otherKeys = Chat.generateKeyPair();
const otherConvKey = Chat.generateConversationKey();
const otherWrapped = Chat.wrapConversationKey(otherConvKey, otherKeys.x25519PublicKey);

let decryptFailed = false;
try {
  chat.decryptConversationKey(otherWrapped); // should fail — wrong private key
} catch {
  decryptFailed = true;
}
assert(decryptFailed, 'Cannot decrypt conversation key with wrong private key');

// ---------------------------------------------------------------------------
// unlock() with non-Juicebox input throws
// ---------------------------------------------------------------------------
console.log('\nunlock() Juicebox stub');
const chat3 = new Chat();
let unlockThrew = false;
try {
  chat3.unlock('1234', '{"not_a_key_bundle": true}');
} catch {
  unlockThrew = true;
}
assert(unlockThrew, 'unlock() throws when given non-Juicebox config without x25519 key');

// unlock() accepts a pre-exported key bundle (for testing)
const chat4 = new Chat();
let unlockAccepted = false;
try {
  chat4.unlock('1234', JSON.stringify({ x25519: keys.x25519PrivateKey, ed25519: keys.ed25519PrivateKey, ed25519_pub: keys.ed25519PublicKey }));
  unlockAccepted = true;
} catch {}
assert(unlockAccepted, 'unlock() accepts pre-exported key bundle');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
