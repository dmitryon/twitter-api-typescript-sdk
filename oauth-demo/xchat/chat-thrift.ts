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

export interface ReplyTo {
  sender_id: number;
  message_text: string;
  sender_display_name?: string;
  replying_to_message_sequence_id: string;
  replying_to_message_id?: string;
}

export function encodePlaintextPayload(text: string, replyTo?: ReplyTo): Buffer {
  const message: any = { message_text: text, sent_from: 1 };
  if (replyTo) {
    message.replying_to_preview = {
      sender_id: replyTo.sender_id,
      message_text: replyTo.message_text,
      sender_display_name: replyTo.sender_display_name,
      replying_to_message_sequence_id: replyTo.replying_to_message_sequence_id,
      replying_to_message_id: replyTo.replying_to_message_id,
    };
  }
  return encode(
    { contents: { message } },
    MessageEntryHolderSchema,
  );
}

export function encodeReactionPayload(messageSequenceId: string, emoji: string, remove: boolean): Buffer {
  const contents: any = remove
    ? { reaction_remove: { message_sequence_id: messageSequenceId, emoji } }
    : { reaction_add: { message_sequence_id: messageSequenceId, emoji } };
  return encode({ contents }, MessageEntryHolderSchema);
}

export function encodeEditPayload(messageSequenceId: string, updatedText: string): Buffer {
  return encode(
    { contents: { message_edit: { message_sequence_id: messageSequenceId, updated_text: updatedText } } },
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
    signature_version: '7',
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

export interface DecodedReplyPreview {
  sender_id?: number;
  message_text?: string;
  sender_display_name?: string;
  replying_to_message_sequence_id?: string;
  replying_to_message_id?: string;
}

export interface DecodedForwardedMessage {
  message_text?: string;
  entities?: DecodedEntity[];
}

export interface DecodedMessageContents {
  text?: string;
  entities?: DecodedEntity[];
  attachments?: DecodedAttachment[];
  reply_to?: DecodedReplyPreview;
  forwarded_message?: DecodedForwardedMessage;
}

export interface DecodedReaction {
  message_sequence_id: string;
  emoji: string;
  action: 'add' | 'remove';
}

export interface DecodedEdit {
  message_sequence_id: string;
  updated_text: string;
  entities?: DecodedEntity[];
}

export interface DecodedMessageEntryContents {
  message?: DecodedMessageContents;
  reaction?: DecodedReaction;
  edit?: DecodedEdit;
}

export function decodeMessageEntryHolder(buf: Buffer): DecodedMessageEntryContents | null {
  try {
    const holder = decode(buf, MessageEntryHolderSchema);
    const contents = holder.contents;
    if (!contents) return null;

    // Reaction add
    if (contents.reaction_add) {
      return { reaction: { message_sequence_id: contents.reaction_add.message_sequence_id, emoji: contents.reaction_add.emoji, action: 'add' } };
    }

    // Reaction remove
    if (contents.reaction_remove) {
      return { reaction: { message_sequence_id: contents.reaction_remove.message_sequence_id, emoji: contents.reaction_remove.emoji, action: 'remove' } };
    }

    // Message edit
    if (contents.message_edit) {
      const edit: DecodedEdit = { message_sequence_id: contents.message_edit.message_sequence_id, updated_text: contents.message_edit.updated_text };
      if (contents.message_edit.entities?.length) {
        edit.entities = contents.message_edit.entities.map(mapEntity);
      }
      return { edit };
    }

    // Regular message
    const msg = contents.message;
    if (!msg) return {};

    const result: DecodedMessageContents = { text: msg.message_text };
    if (msg.entities?.length) result.entities = msg.entities.map(mapEntity);

    if (msg.replying_to_preview) {
      result.reply_to = {
        sender_id: msg.replying_to_preview.sender_id,
        message_text: msg.replying_to_preview.message_text,
        sender_display_name: msg.replying_to_preview.sender_display_name,
        replying_to_message_sequence_id: msg.replying_to_preview.replying_to_message_sequence_id,
        replying_to_message_id: msg.replying_to_preview.replying_to_message_id,
      };
    }

    if (msg.forwarded_message) {
      result.forwarded_message = {
        message_text: msg.forwarded_message.message_text,
        entities: msg.forwarded_message.entities?.length ? msg.forwarded_message.entities.map(mapEntity) : undefined,
      };
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

function mapEntity(e: any): DecodedEntity {
  return {
    start_index: e.start_index,
    end_index: e.end_index,
    type: e.content?.hashtag !== undefined ? 'hashtag'
        : e.content?.cashtag !== undefined ? 'cashtag'
        : e.content?.mention !== undefined ? 'mention'
        : e.content?.url !== undefined ? 'url'
        : e.content?.email !== undefined ? 'email'
        : 'unknown',
  };
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
