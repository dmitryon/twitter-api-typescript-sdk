/**
 * chat-crypto.ts
 *
 * XChat encryption layer — standalone functions, no class wrapper.
 *
 * Encryption stack (from Go reference):
 *   - Conversation key wrapping: P-256 ECDH + KDF2-SHA256 + AES-128-GCM
 *   - Message encryption: XSalsa20-Poly1305 (secretbox)
 *   - Signing: ECDSA P-256 SHA-256 (SignatureVersion "3")
 */

import crypto from 'crypto';
import {
  encodePlaintextPayload,
  encodeMessageCreateEvent,
  encodeMessageEventSignature,
  decodeMessageEntryHolder,
} from './chat-thrift.js';

export type { DecodedMessageContents, DecodedMessageEntryContents, DecodedEntity, DecodedAttachment } from './chat-thrift.js';
export { decodeMessageEntryHolder } from './chat-thrift.js';

// ---------------------------------------------------------------------------
// Conversation key wrapping: P-256 ECDH + KDF2-SHA256 + AES-128-GCM
// Blob: ephPub(65) || AES-GCM(ct+tag)
// ---------------------------------------------------------------------------

function kdf2SHA256(shared: Buffer, other: Buffer, length: number): Buffer {
  const out: Buffer[] = [];
  let counter = 1;
  let total = 0;
  while (total < length) {
    const counterBuf = Buffer.allocUnsafe(4);
    counterBuf.writeUInt32BE(counter, 0);
    const h = crypto.createHash('sha256');
    h.update(shared);
    h.update(counterBuf);
    h.update(other);
    const chunk = h.digest();
    out.push(chunk);
    total += chunk.length;
    counter++;
  }
  return Buffer.concat(out).subarray(0, length);
}

export function unwrapConversationKey(keyB64: string, decryptKeyScalarB64: string): Buffer {
  const blob = Buffer.from(keyB64.replace(/[-_]/g, c => c === '-' ? '+' : '/'), 'base64');
  if (blob.length < 65 + 16) throw new Error(`key blob too short: ${blob.length}`);

  const ephPub = blob.subarray(0, 65);
  const cipherAndTag = blob.subarray(65);

  const ecdhPriv = crypto.createECDH('prime256v1');
  ecdhPriv.setPrivateKey(Buffer.from(decryptKeyScalarB64, 'base64'));
  const shared = ecdhPriv.computeSecret(ephPub);

  const kdfOut = kdf2SHA256(shared, ephPub, 32);
  const aesKey = kdfOut.subarray(0, 16);
  const iv = kdfOut.subarray(16, 32);

  const tag = cipherAndTag.subarray(cipherAndTag.length - 16);
  const ciphertext = cipherAndTag.subarray(0, cipherAndTag.length - 16);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (plaintext.length !== 32) throw new Error(`unexpected conversation key length: ${plaintext.length}`);
  return plaintext;
}

export function wrapConversationKey(conversationKey: Buffer, recipientPublicKeyB64: string): string {
  const recipientPub = Buffer.from(recipientPublicKeyB64, 'base64');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const ephPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(recipientPub);

  const kdfOut = kdf2SHA256(shared, ephPub, 32);
  const aesKey = kdfOut.subarray(0, 16);
  const iv = kdfOut.subarray(16, 32);

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(conversationKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([ephPub, ciphertext, tag]).toString('base64');
}

export function getPublicKeyFromScalar(privateScalarB64: string): string {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateScalarB64, 'base64'));
  return ecdh.getPublicKey().toString('base64');
}

export function spkiToRawPublicKey(spkiB64: string): string {
  const der = Buffer.from(spkiB64, 'base64');
  if (der.length !== 91) throw new Error(`unexpected SPKI length: ${der.length}`);
  return der.subarray(26).toString('base64');
}

// ---------------------------------------------------------------------------
// Message encryption: XSalsa20-Poly1305 (secretbox)
// ---------------------------------------------------------------------------

let _nacl: typeof import('tweetnacl') | null = null;
async function nacl() {
  if (!_nacl) _nacl = (await import('tweetnacl')).default;
  return _nacl;
}

export async function secretboxEncrypt(plaintext: Buffer, key: Buffer): Promise<Buffer> {
  const n = await nacl();
  const nonce = crypto.randomBytes(24);
  const sealed = n.secretbox(plaintext, nonce, key);
  return Buffer.concat([nonce, Buffer.from(sealed)]);
}

export async function secretboxDecrypt(nonceCiphertext: Buffer, key: Buffer): Promise<Buffer> {
  const n = await nacl();
  if (nonceCiphertext.length < 24 + 16) throw new Error('secretbox payload too short');
  const nonce = nonceCiphertext.subarray(0, 24);
  const ciphertext = nonceCiphertext.subarray(24);
  const plaintext = n.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('secretbox decrypt failed');
  return Buffer.from(plaintext);
}

// ---------------------------------------------------------------------------
// ECDSA P-256 signing
// ---------------------------------------------------------------------------

function ecdsaSign(privateKeyScalarB64: string, preimage: Buffer): string {
  const scalar = Buffer.from(privateKeyScalarB64, 'base64');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(scalar);

  const key = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420', 'hex'),
      scalar,
      Buffer.from('a144034200', 'hex'),
      ecdh.getPublicKey(),
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  const hash = crypto.createHash('sha256').update(preimage).digest();
  const derSig = crypto.sign(null, hash, key);

  // DER → raw r(32)||s(32)
  let offset = 2;
  offset++;
  const rLen = derSig[offset++];
  const r = derSig.subarray(offset, offset + rLen);
  offset += rLen;
  offset++;
  const sLen = derSig[offset++];
  const s = derSig.subarray(offset, offset + sLen);

  const sig = Buffer.alloc(64);
  r.copy(sig, 32 - Math.min(r.length, 32), Math.max(0, r.length - 32));
  s.copy(sig, 64 - Math.min(s.length, 32), Math.max(0, s.length - 32));
  return sig.toString('base64');
}

function getPublicKeySPKI(privateScalarB64: string): string {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateScalarB64, 'base64'));
  const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
  return Buffer.concat([spkiPrefix, ecdh.getPublicKey()]).toString('base64');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SigningKeyPair {
  signingKeyB64: string;
  decryptKeyB64: string;
  keyVersion: string;
}

export interface EncryptMessageResult {
  encrypted_content: string;
  encoded_event_signature: string;
}

/**
 * Encrypt and sign a message for the XChat API.
 *
 * @param keysJson - JSON string of SigningKeyPair
 * @param encryptedConvKeyB64 - wrapped conversation key (base64)
 * @param text - plaintext message
 * @param messageId - UUID for the message
 * @param senderId - sender's user ID
 * @param conversationId - canonical conversation ID (colon format)
 * @param keyVersion - conversation key version
 * @param signingKeyVersion - public key version for signature
 */
export async function encryptMessage(
  keysJson: string,
  encryptedConvKeyB64: string,
  text: string,
  messageId: string,
  senderId: string,
  conversationId: string,
  keyVersion: string,
  signingKeyVersion: string,
): Promise<EncryptMessageResult> {
  const keys: SigningKeyPair = JSON.parse(keysJson);

  // 1. Encode plaintext → thrift
  const plaintext = encodePlaintextPayload(text);

  // 2. Decrypt conversation key, encrypt with secretbox
  const convKey = unwrapConversationKey(encryptedConvKeyB64, keys.decryptKeyB64);
  const contentsBytes = await secretboxEncrypt(plaintext, convKey);

  // 3. Encode MessageCreateEvent → base64
  const mceThrift = encodeMessageCreateEvent(contentsBytes, keyVersion);
  const encrypted_content = mceThrift.toString('base64');

  // 4. Sign
  const contentsB64NoPad = contentsBytes.toString('base64').replace(/=/g, '');
  const preimage = Buffer.from(
    `MessageCreateEvent,${messageId},${senderId},${conversationId},${keyVersion},${contentsB64NoPad}`
  );
  const signatureB64 = ecdsaSign(keys.signingKeyB64, preimage);

  // 5. Encode MessageEventSignature → base64
  const signingPublicKeySPKI = getPublicKeySPKI(keys.signingKeyB64);
  const sigThrift = encodeMessageEventSignature(signatureB64, signingKeyVersion, signingPublicKeySPKI);
  const encoded_event_signature = sigThrift.toString('base64');

  return { encrypted_content, encoded_event_signature };
}
