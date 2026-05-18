/**
 * chat-thrift.ts
 *
 * Thin wrappers around the generic thrift codec for XChat message structs.
 * All schemas are auto-generated in thrift-models.ts from the Go reference.
 */

import { encode, decode } from './thrift-codec';
import {
  MessageContentsSchema,
  MessageEntryContentsSchema,
  MessageEntryHolderSchema,
  MessageCreateEventSchema,
  MessageEventSignatureSchema,
  MessageEventSchema,
} from './thrift-models';

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function encodePlaintextPayload(text: string): Buffer {
  return encode(
    { contents: { message: { message_text: text, sent_from: 1 } } },
    MessageEntryHolderSchema,
  );
}

export function encodeMessageCreateEvent(
  encryptedContents: Buffer,
  conversationKeyVersion: string,
): Buffer {
  return encode({
    contents: encryptedContents,
    conversation_key_version: conversationKeyVersion,
    should_notify: true,
    is_pending_public_key: false,
    priority: 1,
  }, MessageCreateEventSchema);
}

export function encodeMessageEventSignature(
  signatureB64: string,
  publicKeyVersion: string,
  signingPublicKeySPKI: string,
): Buffer {
  return encode({
    signature: signatureB64,
    public_key_version: publicKeyVersion,
    signature_version: '3',
    signing_public_key: signingPublicKeySPKI,
  }, MessageEventSignatureSchema);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface DecodedEntity {
  start_index: number;
  end_index: number;
  type: 'hashtag' | 'cashtag' | 'mention' | 'url' | 'email' | 'unknown';
}

export interface DecodedAttachment {
  media_hash_key?: string;
  width?: number;
  height?: number;
  type?: number;
  filename?: string;
  filesize_bytes?: number;
  attachment_id?: string;
  url?: string;
  display_url?: string;
}

export interface DecodedMessageContents {
  text?: string;
  entities?: DecodedEntity[];
  attachments?: DecodedAttachment[];
}

export interface DecodedMessageEntryContents {
  message?: DecodedMessageContents;
}

export function decodeMessageEntryHolder(buf: Buffer): DecodedMessageEntryContents | null {
  try {
    const holder = decode(buf, MessageEntryHolderSchema);
    const msg = holder.contents?.message;
    if (!msg) return holder.contents ? { message: undefined } : null;

    const result: DecodedMessageContents = { text: msg.message_text };

    if (msg.entities?.length) {
      result.entities = msg.entities.map((e: any) => ({
        start_index: e.start_index,
        end_index: e.end_index,
        type: e.content?.hashtag !== undefined ? 'hashtag'
            : e.content?.cashtag !== undefined ? 'cashtag'
            : e.content?.mention !== undefined ? 'mention'
            : e.content?.url !== undefined ? 'url'
            : e.content?.email !== undefined ? 'email'
            : 'unknown',
      }));
    }

    if (msg.attachments?.length) {
      result.attachments = msg.attachments.map((a: any) => {
        if (a.media) return {
          media_hash_key: a.media.media_hash_key,
          width: a.media.dimensions?.width,
          height: a.media.dimensions?.height,
          type: a.media.type,
          filename: a.media.filename,
          filesize_bytes: a.media.filesize_bytes,
          attachment_id: a.media.attachment_id,
        };
        if (a.url) return {
          url: a.url.url,
          display_url: a.url.display_title,
          attachment_id: a.url.attachment_id,
        };
        return {};
      });
    }

    return { message: result };
  } catch {
    return null;
  }
}

/**
 * Parse a thrift-encoded MessageEvent and extract the encrypted contents bytes
 * from MessageEvent.detail.messageCreateEvent.contents (field 7.1.100).
 */
export function extractContentsFromMessageEvent(buf: Buffer): Buffer | null {
  try {
    const event = decode(buf, MessageEventSchema);
    const contents = event.detail?.messageCreateEvent?.contents;
    return contents ? Buffer.from(contents) : null;
  } catch {
    return null;
  }
}
