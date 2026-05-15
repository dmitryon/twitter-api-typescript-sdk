/**
 * chat-crypto.ts
 *
 * Best-effort TypeScript implementation of the chat-xdk encryption layer.
 * Deduced from xchat-bot-python, xchat-bot-go, the OpenAPI spec, and the
 * chat-xdk API surface (Chat.unlock, Chat.decrypt_event,
 * Chat.decrypt_conversation_key, Chat.encrypt_message_for_api).
 *
 * Encryption stack:
 *   Key types:       X25519 (key agreement) + Ed25519 (signing)
 *   Key custody:     Juicebox (PIN-based threshold secret sharing)
 *   Conv key wrap:   ECIES — X25519 ephemeral + HKDF-SHA256 + AES-256-GCM
 *   Message enc:     AES-256-GCM with decrypted conversation key
 *   Wire format:     Apache Thrift binary — see chat-thrift.ts
 *   Message signing: Ed25519
 */

import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import crypto from 'crypto';
import {
  encodeMessageCreateEvent,
  encodeMessageEventSignature,
  decodeEvent,
} from './chat-thrift.js';

export type { TextMessage, KeyChangeEvent, DecodedEvent } from './chat-thrift.js';

// ---------------------------------------------------------------------------
// ECIES: X25519 + HKDF-SHA256 + AES-256-GCM
// Used to wrap/unwrap the conversation key per-participant
// ---------------------------------------------------------------------------

const HKDF_INFO = Buffer.from('xchat-conversation-key');

function eciesEncrypt(recipientPublicKeyB64: string, plaintext: Buffer): Buffer {
  const recipientPub = Buffer.from(recipientPublicKeyB64, 'base64');
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientPub);
  const encKey = hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: ephemeralPub (32) | iv (12) | tag (16) | ciphertext
  return Buffer.concat([ephemeralPub, iv, tag, ciphertext]);
}

function eciesDecrypt(privateKeyB64: string, encrypted: Buffer): Buffer {
  const privateKey = Buffer.from(privateKeyB64, 'base64');
  const ephemeralPub = encrypted.subarray(0, 32);
  const iv = encrypted.subarray(32, 44);
  const tag = encrypted.subarray(44, 60);
  const ciphertext = encrypted.subarray(60);
  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPub);
  const encKey = hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// AES-256-GCM message encryption with conversation key
// ---------------------------------------------------------------------------

function aesGcmEncrypt(keyB64: string, plaintext: Buffer): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv (12) | tag (16) | ciphertext
  return Buffer.concat([iv, tag, ciphertext]);
}

function aesGcmDecrypt(keyB64: string, encrypted: Buffer): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Public API — mirrors chat-xdk Chat class
// ---------------------------------------------------------------------------

export interface EncryptMessageResult {
  encrypted_content: string;       // base64 — encoded_message_create_event
  encoded_event_signature: string; // base64 — encoded_message_event_signature
}

export class Chat {
  private privateKeyB64: string | null = null;
  private signingPrivateKeyB64: string | null = null;
  private signingPublicKeyB64: string | null = null;

  /**
   * Import previously exported private keys.
   * Format: JSON string { x25519: base64, ed25519: base64, ed25519_pub: base64 }
   */
  importKeys(privateKeys: string): void {
    const parsed = JSON.parse(privateKeys);
    this.privateKeyB64 = parsed.x25519;
    this.signingPrivateKeyB64 = parsed.ed25519;
    this.signingPublicKeyB64 = parsed.ed25519_pub;
  }

  exportKeys(): string {
    return JSON.stringify({
      x25519: this.privateKeyB64,
      ed25519: this.signingPrivateKeyB64,
      ed25519_pub: this.signingPublicKeyB64,
    });
  }

  /**
   * Unlock private keys from Juicebox using PIN.
   * Real implementation requires the Juicebox SDK (Rust/Python only).
   * Accepts a pre-exported key bundle JSON for testing.
   */
  unlock(_pin: string, juiceboxConfigJson: string): void {
    try {
      const parsed = JSON.parse(juiceboxConfigJson);
      if (parsed.x25519) {
        this.importKeys(juiceboxConfigJson);
        return;
      }
    } catch {}
    throw new Error(
      'chat-xdk Juicebox unlock requires the Rust/Python XDK. ' +
      'Store private keys via PATCH /xchat/settings after unlocking with the Python bot.'
    );
  }

  /**
   * Decrypt the encrypted_conversation_key from an event payload.
   * Returns the raw AES-256 key as base64.
   */
  decryptConversationKey(encryptedKeyB64: string): string {
    if (!this.privateKeyB64) throw new Error('Keys not loaded — call importKeys() first');
    return eciesDecrypt(this.privateKeyB64, Buffer.from(encryptedKeyB64, 'base64')).toString('base64');
  }

  /**
   * Decrypt an encoded_event (or conversation_key_change_event).
   * Pass empty string for encryptedKeyB64 for KeyChange events.
   */
  decryptEvent(encodedEventB64: string, encryptedKeyB64: string) {
    const eventBytes = Buffer.from(encodedEventB64, 'base64');
    if (!encryptedKeyB64) {
      return decodeEvent(eventBytes);
    }
    if (!this.privateKeyB64) throw new Error('Keys not loaded — call importKeys() first');
    const convKeyB64 = this.decryptConversationKey(encryptedKeyB64);
    return decodeEvent(aesGcmDecrypt(convKeyB64, eventBytes));
  }

  /**
   * Encrypt a text message for the API.
   * Mirrors: chat.encrypt_message_for_api(msg_id, user_id, conv_id, enc_key, text, key_version, signing_key_version)
   */
  encryptMessageForApi(
    messageId: string,
    senderId: string,
    conversationId: string,
    encryptedConvKeyB64: string,
    text: string,
    keyVersion: string,
    signingKeyVersion: string,
  ): EncryptMessageResult {
    if (!this.privateKeyB64 || !this.signingPrivateKeyB64 || !this.signingPublicKeyB64) {
      throw new Error('Keys not loaded — call importKeys() first');
    }

    const convKeyB64 = this.decryptConversationKey(encryptedConvKeyB64);
    const thriftMessage = encodeMessageCreateEvent(messageId, senderId, conversationId, text);
    const encryptedMessage = aesGcmEncrypt(convKeyB64, thriftMessage);

    const signingPrivKey = Buffer.from(this.signingPrivateKeyB64, 'base64');
    const signingPubKey = Buffer.from(this.signingPublicKeyB64, 'base64');
    const signature = Buffer.from(ed25519.sign(encryptedMessage, signingPrivKey));

    const thriftSig = encodeMessageEventSignature(
      messageId, senderId, conversationId,
      signature, signingPubKey, signingKeyVersion,
    );

    return {
      encrypted_content: encryptedMessage.toString('base64'),
      encoded_event_signature: thriftSig.toString('base64'),
    };
  }

  static generateKeyPair() {
    const x25519Priv = x25519.utils.randomSecretKey();
    const ed25519Priv = ed25519.utils.randomSecretKey();
    return {
      x25519PrivateKey: Buffer.from(x25519Priv).toString('base64'),
      x25519PublicKey:  Buffer.from(x25519.getPublicKey(x25519Priv)).toString('base64'),
      ed25519PrivateKey: Buffer.from(ed25519Priv).toString('base64'),
      ed25519PublicKey:  Buffer.from(ed25519.getPublicKey(ed25519Priv)).toString('base64'),
    };
  }

  static wrapConversationKey(convKeyB64: string, recipientPublicKeyB64: string): string {
    return eciesEncrypt(recipientPublicKeyB64, Buffer.from(convKeyB64, 'base64')).toString('base64');
  }

  static generateConversationKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
