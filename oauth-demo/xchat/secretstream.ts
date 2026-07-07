/**
 * secretstream.ts
 *
 * XChat media decryption using libsodium's crypto_secretstream_xchacha20poly1305.
 *
 * Format: header(24) || chunk1 || chunk2 || ... || chunkN
 * Each encrypted chunk = plaintext + 17 bytes overhead (1 tag + 16 MAC).
 * Default plaintext chunk size is 1024 bytes → encrypted chunk = 1041 bytes.
 */

import _sodium from 'libsodium-wrappers';
import { Readable, Transform } from 'stream';

const STREAM_HEADER_BYTES = 24;
const STREAM_A_BYTES = 17;
const PLAINTEXT_CHUNK_SIZE = 1024;
const ENCRYPTED_CHUNK_SIZE = PLAINTEXT_CHUNK_SIZE + STREAM_A_BYTES;

let ready: Promise<void> | null = null;
async function ensureReady() {
  if (!ready) ready = _sodium.ready;
  await ready;
}

/**
 * Decrypt a secretstream (XChaCha20-Poly1305) ciphertext.
 * @param ciphertext - header(24) || encrypted_chunks
 * @param key - 32-byte conversation key
 * @returns decrypted plaintext
 */
export function secretstreamDecrypt(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error(`secretstream key must be 32 bytes, got ${key.length}`);
  if (ciphertext.length < STREAM_HEADER_BYTES) throw new Error('secretstream ciphertext too short for header');

  const sodium = _sodium;
  const header = new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, STREAM_HEADER_BYTES);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, new Uint8Array(key.buffer, key.byteOffset, key.length));

  const plaintext: Uint8Array[] = [];
  let offset = STREAM_HEADER_BYTES;

  while (offset < ciphertext.length) {
    let end = offset + ENCRYPTED_CHUNK_SIZE;
    if (end > ciphertext.length) end = ciphertext.length;

    const chunk = new Uint8Array(ciphertext.buffer, ciphertext.byteOffset + offset, end - offset);
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, chunk);
    if (!result) throw new Error(`secretstream decrypt failed at offset ${offset}`);

    plaintext.push(result.message);

    if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) break;
    offset = end;
  }

  return Buffer.concat(plaintext);
}

/**
 * Async version that ensures libsodium is initialized before use.
 */
export async function secretstreamDecryptAsync(ciphertext: Buffer, key: Buffer): Promise<Buffer> {
  await ensureReady();
  return secretstreamDecrypt(ciphertext, key);
}

/**
 * Create a Transform stream that decrypts secretstream data on the fly.
 * Feed encrypted bytes in, get decrypted bytes out.
 * The first 24 bytes are consumed as the header; subsequent data is
 * processed in ENCRYPTED_CHUNK_SIZE (1041-byte) frames.
 */
export async function createSecretstreamDecryptTransform(key: Buffer): Promise<Transform> {
  await ensureReady();
  if (key.length !== 32) throw new Error(`secretstream key must be 32 bytes, got ${key.length}`);

  const sodium = _sodium;
  let state: any = null;
  let buf = Buffer.alloc(0);
  let headerConsumed = false;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      buf = Buffer.concat([buf, chunk]);
      try {
        // Consume header
        if (!headerConsumed) {
          if (buf.length < STREAM_HEADER_BYTES) { callback(); return; }
          const header = new Uint8Array(buf.buffer, buf.byteOffset, STREAM_HEADER_BYTES);
          state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
            header, new Uint8Array(key.buffer, key.byteOffset, key.length)
          );
          buf = buf.subarray(STREAM_HEADER_BYTES);
          headerConsumed = true;
        }
        // Process complete encrypted chunks
        while (buf.length >= ENCRYPTED_CHUNK_SIZE) {
          const frame = new Uint8Array(buf.buffer, buf.byteOffset, ENCRYPTED_CHUNK_SIZE);
          const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, frame);
          if (!result) { callback(new Error('secretstream decrypt failed')); return; }
          this.push(Buffer.from(result.message));
          buf = buf.subarray(ENCRYPTED_CHUNK_SIZE);
          if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
            buf = Buffer.alloc(0);
            break;
          }
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      // Process any remaining partial final chunk
      if (buf.length > 0 && state) {
        try {
          const frame = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
          const result = _sodium.crypto_secretstream_xchacha20poly1305_pull(state, frame);
          if (result) this.push(Buffer.from(result.message));
        } catch {}
      }
      callback();
    },
  });
}

/**
 * Encrypt plaintext using secretstream (XChaCha20-Poly1305).
 * Uses 1024-byte plaintext chunks matching the Go reference implementation.
 * @param plaintext - data to encrypt
 * @param key - 32-byte conversation key
 * @returns header(24) || encrypted_chunks
 */
export function secretstreamEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error(`secretstream key must be 32 bytes, got ${key.length}`);

  const sodium = _sodium;
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(
    new Uint8Array(key.buffer, key.byteOffset, key.length)
  );

  const chunks: Uint8Array[] = [header];

  if (plaintext.length === 0) {
    chunks.push(sodium.crypto_secretstream_xchacha20poly1305_push(
      state, new Uint8Array(0), null,
      sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
    ));
  } else {
    for (let offset = 0; offset < plaintext.length; offset += PLAINTEXT_CHUNK_SIZE) {
      const isLast = offset + PLAINTEXT_CHUNK_SIZE >= plaintext.length;
      const end = isLast ? plaintext.length : offset + PLAINTEXT_CHUNK_SIZE;
      const chunk = new Uint8Array(plaintext.buffer, plaintext.byteOffset + offset, end - offset);
      const tag = isLast
        ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
        : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
      chunks.push(sodium.crypto_secretstream_xchacha20poly1305_push(state, chunk, null, tag));
    }
  }

  return Buffer.concat(chunks);
}

/**
 * Async version that ensures libsodium is initialized before use.
 */
export async function secretstreamEncryptAsync(plaintext: Buffer, key: Buffer): Promise<Buffer> {
  await ensureReady();
  return secretstreamEncrypt(plaintext, key);
}
