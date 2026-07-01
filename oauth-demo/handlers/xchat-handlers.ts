import { Request, Response } from "express";
import { resolveAuth, mediaCache, sseResponse, integrationStorage, accessTokenStorage } from "./handler-utils";
import { rest } from "twitter-api-sdk";
import { UserPublicKeyStorage, ConversationKeyStorage, UserXChatStorage, JuiceboxCallLogger, KeyRecoveryHistoryStorage } from "../storage";
import { log } from "../logger";
import { toCanonicalConvId, toApiConvId, extractRecipientId } from "../xchat/xchat-utils";
import {
  encryptMessage,
  encryptReaction,
  encryptEdit,
  unwrapConversationKey,
  secretboxDecrypt,
  wrapConversationKey,
  getPublicKeyFromScalar,
  spkiToRawPublicKey,
  ecdsaSign,
  ecdsaSignRaw,
  getPublicKeySPKI
} from "../xchat/chat-crypto";
import { extractContentsFromMessageEvent, decodeMessageEntryHolder } from "../xchat/chat-thrift";
import { decode } from "../xchat/thrift-codec";
import { MessageEventSchema } from "../xchat/thrift-models";
import { recover, register as juiceboxRegister } from "../xchat/juicebox/client";
import { secretstreamDecryptAsync, secretstreamEncryptAsync } from "../xchat/secretstream";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { __dirname } from "../esm-utils";

const userPublicKeyStorage = new UserPublicKeyStorage();
const conversationKeyStorage = new ConversationKeyStorage();
const userXChatStorage = new UserXChatStorage();
const juiceboxLogger = new JuiceboxCallLogger();
const keyRecoveryHistory = new KeyRecoveryHistoryStorage();

// Ensure storage directories exist
Promise.all([userPublicKeyStorage.init(), conversationKeyStorage.init(), userXChatStorage.init(), juiceboxLogger.init(), keyRecoveryHistory.init()]).catch(() => {});

/** Transform raw juicebox_config from API into the format expected by the Juicebox client. */
function buildJuiceboxConfigJson(jbConfig: any): string {
  const tokens: Record<string, string> = {};
  if (jbConfig.token_map && Array.isArray(jbConfig.token_map)) {
    for (const t of jbConfig.token_map) tokens[t.key] = t.value?.token ?? t.value;
  }
  return JSON.stringify({ sdk_config: jbConfig.key_store_token_map_json, tokens, max_guess_count: jbConfig.max_guess_count });
}
/** Resolve the OAuth2 user ID for an integration. */
async function resolveUserId(integrationId: string): Promise<string | null> {
  const integration = await integrationStorage.load(integrationId);
  const accessTokenId = integration?.oauth2?.accessTokenId;
  if (!accessTokenId) return null;
  const entry = await accessTokenStorage.load(accessTokenId);
  return entry?.user?.id ?? null;
}

export const getXChatConversations = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const response = await resolved.client.chat.getChatConversations({
      "chat_conversation.fields": ["id", "type", "participant_ids", "member_ids", "admin_ids", "group_name", "created_at", "updated_at"],
    });

    log.debug('xchat', `Fetched conversations for integration ${integrationId} (${response.data?.length || 0})`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `getXChatConversations failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const getXChatMessages = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, conversationId } = req.params;
    const { auth: authType, pagination_token } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);

    // Resolve user ID and keys for decryption
    const userId = await resolveUserId(integrationId);
    const keysResult = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;
    const keys = keysResult?.private_key ? JSON.parse(keysResult.private_key) : null;

    // Get conversation key
    let convKey: Buffer | null = null;
    if (keys?.decryptKeyB64) {
      const cached = await conversationKeyStorage.load(canonicalId);
      if (cached?.encrypted_conversation_key) {
        try {
          
          convKey = unwrapConversationKey(cached.encrypted_conversation_key, keys.decryptKeyB64);
        } catch {}
      }
    }

    // Fetch events from API
    log.debug('xchat', `getXChatMessages: fetching events from API for ${apiConvId}`);
    try {
      const eventsResp = await resolved.client.chat.getChatConversationEvents(apiConvId, {
        max_results: 100,
        ...(pagination_token ? { pagination_token: pagination_token as string } : {}),
      });

      // Extract conversation key(s) from response metadata, indexed by version
      const convKeysByVersion = new Map<string, Buffer>();
      if (convKey) convKeysByVersion.set('', convKey); // cached key (version unknown)
      if (keys?.decryptKeyB64 && (eventsResp as any).meta?.conversation_key_events?.length) {
        
        for (const keyEventB64 of (eventsResp as any).meta.conversation_key_events) {
          try {
            const keyBuf = Buffer.from(keyEventB64, 'base64');
            const keyEvent = decode(keyBuf, MessageEventSchema);
            const kce = keyEvent.detail?.conversationKeyChangeEvent;
            if (!kce) continue;
            const keyVersion = kce.conversation_key_version || '';
            const participantKeys: any[] = kce.conversation_participant_keys || [];
            const ours = participantKeys.find((pk: any) => pk.user_id === userId);
            if (!ours?.encrypted_conversation_key) continue;
            try {
              const extracted = unwrapConversationKey(ours.encrypted_conversation_key, keys.decryptKeyB64);
              convKeysByVersion.set(keyVersion, extracted);
              if (!convKey) {
                convKey = extracted;
                await conversationKeyStorage.save({ id: canonicalId, encrypted_conversation_key: ours.encrypted_conversation_key, key_version: keyVersion, cached_at: new Date().toISOString() });
              }
            } catch {}
          } catch {}
        }
        if (convKeysByVersion.size > 0) {
          log.debug('xchat', `getXChatMessages: extracted ${convKeysByVersion.size} conversation key(s) from API response`);
        }
      }

      const messages: any[] = [];
      
      

      for (const event of (eventsResp as any).data || []) {
        const msg: any = {
          id: event.id,
          sender_id: event.sender_id,
          conversation_id: event.conversation_id,
          created_at: event.created_at_msec ? new Date(parseInt(event.created_at_msec)).toISOString() : undefined,
          encrypted: true,
          source: 'api',
        };

        // Try to decrypt
        if (convKeysByVersion.size > 0 && event.encoded_event) {
          try {
            const eventBuf = Buffer.from(event.encoded_event, 'base64');

            // Check for group change events (not encrypted)
            const fullEvent = decode(eventBuf, MessageEventSchema);
            if (fullEvent.detail?.groupChangeEvent) {
              const gc = fullEvent.detail.groupChangeEvent.group_change;
              if (gc?.group_member_add) {
                msg.group_event = { type: 'member_add', member_ids: gc.group_member_add.member_ids };
              } else if (gc?.group_member_remove) {
                msg.group_event = { type: 'member_remove', member_ids: gc.group_member_remove.member_ids };
              } else if (gc?.group_title_change) {
                msg.group_event = { type: 'title_change', title: gc.group_title_change.custom_title };
              } else if (gc?.group_create) {
                msg.group_event = { type: 'group_create', member_ids: gc.group_create.member_ids, admin_ids: gc.group_create.admin_ids };
              }
              msg.encrypted = false;
              messages.push(msg);
              continue;
            }

            // Standalone key change events
            if (fullEvent.detail?.conversationKeyChangeEvent && !fullEvent.detail?.messageCreateEvent) {
              msg.group_event = { type: 'key_change', version: fullEvent.detail.conversationKeyChangeEvent.conversation_key_version };
              msg.encrypted = false;
              messages.push(msg);
              continue;
            }

            const contents = extractContentsFromMessageEvent(eventBuf);
            if (contents) {
              // Look up key by version from MessageCreateEvent, fallback to trying all
              const mceVersion = fullEvent.detail?.messageCreateEvent?.conversation_key_version || '';
              const keysToTry = convKeysByVersion.has(mceVersion)
                ? [convKeysByVersion.get(mceVersion)!]
                : [...convKeysByVersion.values()];

              let decrypted = false;
              for (const key of keysToTry) {
                try {
                  const plaintext = await secretboxDecrypt(contents, key);
                  const decoded = decodeMessageEntryHolder(plaintext);
                  if (decoded?.message) {
                    msg.text = decoded.message.text || null;
                    msg.entities = decoded.message.entities || null;
                    msg.attachments = decoded.message.attachments?.map((a: any) => ({
                      media_hash_key: a.media_hash_key,
                      type: a.type === 1 ? 'image' : a.type === 2 ? 'gif' : a.type === 3 ? 'video' : a.type === 4 ? 'audio' : a.type === 5 ? 'file' : a.type === 6 ? 'svg' : a.url ? 'url' : `unknown(${a.type})`,
                      filename: a.filename,
                      url: a.url,
                      display_url: a.display_url,
                      width: a.width,
                      height: a.height,
                      filesize_bytes: a.filesize_bytes,
                    })) || null;
                    if (decoded.message.reply_to) msg.reply_to = decoded.message.reply_to;
                    msg.encrypted = false;
                  } else if (decoded?.reaction) {
                    msg.reaction = decoded.reaction;
                    msg.encrypted = false;
                  } else if (decoded?.edit) {
                    msg.edit = decoded.edit;
                    msg.encrypted = false;
                  }
                  decrypted = true;
                  break;
                } catch {}
              }
              if (!decrypted) {
                log.debug('xchat', `getXChatMessages: decrypt failed for event ${event.id} (key_version=${mceVersion}, tried ${keysToTry.length} keys)`);
              }
            }
          } catch (decErr: any) {
            log.debug('xchat', `getXChatMessages: decrypt failed for event ${event.id}: ${decErr.message}`);
          }
        }

        messages.push(msg);
      }

      // Events come newest-first from API, reverse for chronological order
      messages.reverse();

      // Aggregate reactions and edits into their parent messages
      const messageMap = new Map<string, any>();
      const aggregated: any[] = [];
      for (const msg of messages) {
        if (msg.reaction) {
          const target = messageMap.get(msg.reaction.message_sequence_id);
          if (target) {
            if (!target.reactions) target.reactions = [];
            if (msg.reaction.action === 'add') {
              target.reactions.push({ emoji: msg.reaction.emoji, sender_id: msg.sender_id });
            } else {
              target.reactions = target.reactions.filter((r: any) => !(r.emoji === msg.reaction.emoji && r.sender_id === msg.sender_id));
            }
          } else {
            // Parent message not in this page — show as standalone
            aggregated.push(msg);
          }
        } else if (msg.edit) {
          const target = messageMap.get(msg.edit.message_sequence_id);
          if (target) {
            target.text = msg.edit.updated_text;
            target.entities = msg.edit.entities || null;
            target.edited = true;
          } else {
            // Parent message not in this page — show as standalone
            aggregated.push(msg);
          }
        } else if (!msg.encrypted || msg.text || msg.attachments) {
          // Regular message or decrypted message
          messageMap.set(msg.id, msg);
          aggregated.push(msg);
        } else {
          // Encrypted event with no content (key change events) — skip
        }
      }

      const meta: any = { source: 'api', result_count: aggregated.length };
      if ((eventsResp as any).meta?.next_token) meta.next_token = (eventsResp as any).meta.next_token;
      if ((eventsResp as any).meta?.previous_token) meta.previous_token = (eventsResp as any).meta.previous_token;

      log.debug('xchat', `getXChatMessages: fetched ${messages.length} events from API (${aggregated.length} messages, ${messages.length - aggregated.length} reactions/edits)`);
      res.json({ data: aggregated, meta });
      return;
    } catch (apiErr: any) {
      log.warn('xchat', `getXChatMessages: API fetch failed (${apiErr.status || 'unknown'}), falling back to webhooks`);
    }

    // Fallback: load from webhook files
    const webhookDir = path.join(__dirname(import.meta.url), '../data/webhooks');

    let messages: any[] = [];
    try {
      const files = await fs.readdir(webhookDir);
      const webhookFiles = files.filter(f => f.endsWith('.json')).sort();

      for (const file of webhookFiles) {
        try {
          const data = JSON.parse(await fs.readFile(path.join(webhookDir, file), 'utf8'));
          const payload = data.body?.data?.payload;
          if (!payload?.conversation_id) continue;
          if (payload.conversation_id !== canonicalId && payload.conversation_id !== apiConvId) continue;
          if (data.body?.data?.event_type !== 'chat.received' && data.body?.data?.event_type !== 'chat.sent') continue;

          messages.push({
            id: payload.id,
            sender_id: payload.sender_id,
            conversation_id: payload.conversation_id,
            created_at: payload.created_at_msec ? new Date(parseInt(payload.created_at_msec)).toISOString() : data.timestamp,
            text: data.decrypted?.text || null,
            entities: data.decrypted?.entities || null,
            attachments: data.decrypted?.attachments || null,
            encrypted: !data.decrypted,
            source: 'webhook',
          });
        } catch { /* skip malformed files */ }
      }
    } catch { /* webhook dir might not exist */ }

    messages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    log.debug('xchat', `getXChatMessages: found ${messages.length} messages from webhooks`);
    res.json({ data: messages, meta: { source: 'webhooks', result_count: messages.length } });
  } catch (error: any) {
    log.error('xchat', `getXChatMessages failed:`, error.message || error);
    const status = error.status || 500;
    const message = error.message?.includes('<!DOCTYPE') ? `${status} Error` : error.message || 'Unknown error';
    res.status(status).json({ error: message });
  }
};

export const sendXChatMessage = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { text, media_hash_key, reply_to } = req.body;
    let { conversation_token, key_version, encrypted_conversation_key } = req.body;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const userId = await resolveUserId(integrationId);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID for integration" });
      return;
    }

    const keysResult = await ensureKeys(userId, resolved.client);
    if (!keysResult) {
      res.status(400).json({ error: "Keys not available. Set PIN and try again." });
      return;
    }

    const message_id = crypto.randomUUID();
    const apiConvId = toApiConvId(conversationId);
    const convKeyId = toCanonicalConvId(conversationId);

    // Resolve missing conversation_token, key_version, and conversation key from cache or API
    const convKeyEntry = await conversationKeyStorage.load(convKeyId);
    let encryptedConvKey = encrypted_conversation_key || convKeyEntry?.encrypted_conversation_key;
    if (!key_version && convKeyEntry?.key_version) key_version = convKeyEntry.key_version;

    if (!conversation_token || !encryptedConvKey || !key_version) {
      log.debug('xchat', `[send] fetching events to resolve missing params (token=${!!conversation_token}, key=${!!encryptedConvKey}, version=${!!key_version})`);
      const eventsResp = await resolved.client.chat.getChatConversationEvents(apiConvId, { max_results: 1 }) as any;

      // Get conversation_token from the latest event
      if (!conversation_token && eventsResp.data?.length) {
        conversation_token = eventsResp.data[0].conversation_token;
      }

      // Extract conversation key from meta.conversation_key_events
      if ((!encryptedConvKey || !key_version) && eventsResp.meta?.conversation_key_events?.length) {
        for (const keyEventB64 of eventsResp.meta.conversation_key_events) {
          try {
            const keyBuf = Buffer.from(keyEventB64, 'base64');
            const keyEvent = decode(keyBuf, MessageEventSchema);
            const kce = keyEvent.detail?.conversationKeyChangeEvent;
            if (!kce) continue;
            const ours = (kce.conversation_participant_keys || []).find((pk: any) => pk.user_id === userId);
            if (!ours?.encrypted_conversation_key) continue;
            encryptedConvKey = ours.encrypted_conversation_key;
            key_version = kce.conversation_key_version || key_version;
            await conversationKeyStorage.save({ id: convKeyId, encrypted_conversation_key: encryptedConvKey, key_version: key_version || '', cached_at: new Date().toISOString() });
            break;
          } catch {}
        }
      }
    }

    if (!encryptedConvKey) {
      res.status(400).json({ error: "No conversation key available. Cannot encrypt message." });
      return;
    }

    log.debug('xchat', `[send] encrypting message (key_version=${key_version})`);
    const payload = await encryptMessage(
      keysResult.private_key,
      encryptedConvKey,
      text,
      message_id,
      userId,
      convKeyId,
      key_version ?? '1',
      keysResult.signing_key_version ?? '1',
      reply_to,
    );

    const response = await resolved.client.chat.sendChatMessage(apiConvId, {
      encoded_message_create_event: payload.encrypted_content,
      encoded_message_event_signature: payload.encoded_event_signature,
      message_id,
      ...(conversation_token ? { conversation_token } : {}),
    });

    log.info('xchat', `Sent message to conversation ${conversationId} (message_id=${message_id})`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `sendXChatMessage failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const getUserPublicKeys = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, userId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const response = await resolved.client.users.getUsersPublicKey(userId) as any;
    log.debug('xchat', `Fetched public keys for user ${userId}`);

    const keyEntry = Array.isArray(response?.data) ? response.data[response.data.length - 1] : response?.data;
    if (keyEntry) {
      await userPublicKeyStorage.save({
        id: userId,
        public_key: keyEntry.public_key,
        signing_public_key: keyEntry.signing_public_key,
        version: keyEntry.version,
        juicebox_config: keyEntry.juicebox_config ?? keyEntry.token_map,
        cached_at: new Date().toISOString(),
      });
    }

    res.json(response);
  } catch (error: any) {
    log.error('xchat', `getUserPublicKeys failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const uploadXChatMedia = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const { media, conversation_id } = req.body;
    const plaintextBuffer = Buffer.from(media, 'base64');
    const sendEvent = sseResponse(res);

    // Encrypt media with conversation key using secretstream
    const canonicalId = toCanonicalConvId(conversation_id);
    const userId = await resolveUserId(integrationId);
    const keysResult = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;
    const keys = keysResult?.private_key ? JSON.parse(keysResult.private_key) : null;

    let mediaBuffer: Buffer;
    if (keys?.decryptKeyB64) {
      const convKeyEntry = await conversationKeyStorage.load(canonicalId);
      if (convKeyEntry?.encrypted_conversation_key) {
        const convKey = unwrapConversationKey(convKeyEntry.encrypted_conversation_key, keys.decryptKeyB64);
        sendEvent({ step: 'encrypting', detail: `${plaintextBuffer.length} bytes` });
        mediaBuffer = await secretstreamEncryptAsync(plaintextBuffer, convKey);
        log.debug('xchat', `Media encrypted: ${plaintextBuffer.length} → ${mediaBuffer.length} bytes`);
      } else {
        log.warn('xchat', `No conversation key for ${canonicalId}, uploading unencrypted`);
        mediaBuffer = plaintextBuffer;
      }
    } else {
      log.warn('xchat', `No decrypt key available, uploading unencrypted`);
      mediaBuffer = plaintextBuffer;
    }

    // Step 1: Initialize
    sendEvent({ step: 'init', detail: `${mediaBuffer.length} bytes` });
    const initResponse = await resolved.client.chat.chatMediaUploadInitialize({
      total_bytes: mediaBuffer.length,
      conversation_id,
    });

    const sessionId = initResponse.data?.session_id;
    const mediaHashKey = initResponse.data?.media_hash_key;
    if (!sessionId || !mediaHashKey) {
      sendEvent({ error: 'Failed to initialize upload' });
      res.end();
      return;
    }
    log.debug('xchat', `Media upload initialized: session_id=${sessionId}, media_hash_key=${mediaHashKey}`);

    // Step 2: Append (chunked)
    const SEGMENT_SIZE = 3 * 1024 * 1024;
    const totalSegments = Math.ceil(mediaBuffer.length / SEGMENT_SIZE);
    for (let i = 0; i < totalSegments; i++) {
      const chunk = mediaBuffer.subarray(i * SEGMENT_SIZE, (i + 1) * SEGMENT_SIZE);
      sendEvent({ step: 'append', detail: `segment ${i + 1}/${totalSegments} (${chunk.length} bytes)` });
      await resolved.client.chat.chatMediaUploadAppend(sessionId, {
        media: chunk.toString('base64') as any,
        media_hash_key: mediaHashKey,
        segment_index: i as any,
        conversation_id,
      });
    }
    log.debug('xchat', `Media upload appended: ${totalSegments} segment(s)`);

    // Step 3: Finalize
    sendEvent({ step: 'finalize' });
    await resolved.client.chat.chatMediaUploadFinalize(sessionId, {
      media_hash_key: mediaHashKey,
      conversation_id,
      num_parts: String(totalSegments),
    });

    log.info('xchat', `Media upload finalized: media_hash_key=${mediaHashKey}`);
    sendEvent({ step: 'complete', media_hash_key: mediaHashKey, session_id: sessionId });
    res.end();
  } catch (error: any) {
    log.error('xchat', 'Media upload failed:', error.stack || error);
    const msg = error.message || 'Unknown error';
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    } else {
      res.status(error.status || 500).json({ error: msg });
    }
  }
};

export const proxyXChatMedia = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType, conversation_id, media_hash_key } = req.query;

    if (!conversation_id || !media_hash_key) {
      res.status(400).json({ error: "conversation_id and media_hash_key required" });
      return;
    }

    const cacheKey = `xchat:${conversation_id}:${media_hash_key}`;
    const cached = await mediaCache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.send(cached.buffer);
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const response = await resolved.client.chat.chatMediaDownload(
      conversation_id as string,
      media_hash_key as string
    );

    if (!response.ok) {
      res.status(response.status).json({ error: "Failed to fetch media" });
      return;
    }

    const encryptedBuffer = Buffer.from(await response.arrayBuffer());

    // XChat media is encrypted with the conversation key using secretbox
    const canonicalId = toCanonicalConvId(conversation_id as string);
    const userId = await resolveUserId(integrationId);
    const keysResult = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;
    const keys = keysResult?.private_key ? JSON.parse(keysResult.private_key) : null;

    let decryptedBuffer: Buffer;
    if (keys?.decryptKeyB64) {
      const convKeyEntry = await conversationKeyStorage.load(canonicalId);
      if (convKeyEntry?.encrypted_conversation_key) {
        try {
          const convKey = unwrapConversationKey(convKeyEntry.encrypted_conversation_key, keys.decryptKeyB64);
          decryptedBuffer = await secretstreamDecryptAsync(encryptedBuffer, convKey);
        } catch (decErr: any) {
          log.warn('xchat', `Media decryption failed for ${media_hash_key}: ${decErr.message}`);
          decryptedBuffer = encryptedBuffer;
        }
      } else {
        log.warn('xchat', `No conversation key for ${canonicalId}, serving raw media`);
        decryptedBuffer = encryptedBuffer;
      }
    } else {
      log.warn('xchat', `No decrypt key available, serving raw media`);
      decryptedBuffer = encryptedBuffer;
    }

    // Detect content type from decrypted bytes
    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (decryptedBuffer !== encryptedBuffer) {
      const detected = detectContentType(decryptedBuffer);
      if (detected) contentType = detected;
    }

    await mediaCache.set(cacheKey, decryptedBuffer, contentType);

    res.set('Content-Type', contentType);
    res.send(decryptedBuffer);
  } catch (error: any) {
    log.error('xchat', `Media proxy failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

function detectContentType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length > 11 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf.length > 11 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  return null;
}

export const updateXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { pin, private_key, signing_key_version, conversation_key } = req.body;

    const userId = await resolveUserId(integrationId);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID — ensure OAuth2 is connected" });
      return;
    }

    if (pin !== undefined) {
      if (!/^[0-9]{4}$/.test(pin)) {
        res.status(400).json({ error: "PIN must be exactly 4 digits" });
        return;
      }
      const existing = await userXChatStorage.load(userId) ?? { id: userId, pin };
      await userXChatStorage.save({ ...existing, pin });
    }

    if (private_key !== undefined) {
      const existing = await userXChatStorage.load(userId) ?? { id: userId, pin: '' };
      await userXChatStorage.save({ ...existing, private_key, signing_key_version });
    }

    if (conversation_key) {
      const { conversation_id, key, key_version } = conversation_key;
      await conversationKeyStorage.save({
        id: conversation_id,
        encrypted_conversation_key: key,
        key_version,
        cached_at: new Date().toISOString(),
      });
    }

    log.info('xchat', `Updated xchat settings for user ${userId} (integration ${integrationId})`);
    const xchat = await userXChatStorage.load(userId);
    res.json({ success: true, xchat: { has_pin: !!xchat?.pin, has_private_key: !!xchat?.private_key } });
  } catch (error: any) {
    log.error('xchat', `updateXChatSettings failed:`, error.message || error);
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

export const getXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;

    const userId = await resolveUserId(integrationId);
    if (!userId) {
      res.json({ xchat: null });
      return;
    }

    const xchat = await userXChatStorage.load(userId);
    const hasPin = !!xchat?.pin;
    const hasPrivateKey = !!xchat?.private_key;

    // If keys are already cached, no need to check server
    if (hasPrivateKey) {
      res.json({ xchat: { has_pin: hasPin, has_private_key: true, needs_registration: false, user_id: userId } });
      return;
    }

    // Check if user has published keys on the server
    let needsRegistration = false;
    if (hasPin) {
      try {
        const resolved = await resolveAuth(integrationId, authType as string || 'oauth2');
        if (resolved) {
          const pkResp = await resolved.client.users.getUsersPublicKey(userId) as any;
          const keyEntry = Array.isArray(pkResp?.data) ? pkResp.data[0] : pkResp?.data;
          needsRegistration = !keyEntry?.public_key;
        }
      } catch {
        // If we can't check, assume recovery (safer default)
      }
    }

    res.json({
      xchat: { has_pin: hasPin, has_private_key: false, needs_registration: needsRegistration, user_id: userId },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

/** Ensure user's private keys are available — from cache or by recovering from Juicebox with PIN. */
async function ensureKeys(userId: string, client: any, { force = false } = {}): Promise<{ private_key: string; signing_key_version: string } | null> {
  const xchat = await userXChatStorage.load(userId);
  if (!force && xchat?.private_key) return { private_key: xchat.private_key, signing_key_version: xchat.signing_key_version || '' };
  if (!xchat?.pin) return null;

  const previousKey = xchat.private_key || undefined;
  const previousKeyVersion = xchat.signing_key_version || undefined;

  // Fetch fresh juicebox_config
  const pkData = await client.users.getUsersPublicKey(userId, {
    'public_key.fields': ['version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
  }) as any;
  const raw = Array.isArray(pkData?.data) ? pkData.data[pkData.data.length - 1] : pkData?.data;
  if (!raw?.juicebox_config && !raw?.token_map) return null;

  const jbConfig = raw.juicebox_config ?? raw.token_map;
  const signingKeyVersion = String(raw.version ?? '');
  const tokens: Record<string, string> = {};
  if (jbConfig.token_map && Array.isArray(jbConfig.token_map)) {
    for (const t of jbConfig.token_map) tokens[t.key] = t.value?.token ?? t.value;
  }
  const configJson = JSON.stringify({ sdk_config: jbConfig.key_store_token_map_json, tokens, max_guess_count: jbConfig.max_guess_count });

  const secret = await recover(xchat.pin, configJson, userId, juiceboxLogger);
  const decryptKeyB64 = Buffer.from(secret.slice(0, 32)).toString('base64');
  const signingKeyB64 = secret.length >= 64 ? Buffer.from(secret.slice(32, 64)).toString('base64') : decryptKeyB64;
  const private_key = JSON.stringify({ signingKeyB64, decryptKeyB64, keyVersion: signingKeyVersion });

  await userXChatStorage.save({ ...xchat, private_key, signing_key_version: signingKeyVersion });
  await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: true, recovered_key_version: signingKeyVersion, previous_key_version: previousKeyVersion, previous_key: previousKey, recovered_key: private_key });
  log.info('xchat', `[ensureKeys] recovered and cached keys for user ${userId}`);
  return { private_key, signing_key_version: signingKeyVersion };
}

export const unlockKeys = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Integration not found or invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    try {
      const result = await ensureKeys(userId, resolved.client);
      if (!result) {
        res.json({ success: true, unlocked: false, reason: "PIN not set or no public keys on server" });
        return;
      }
      res.json({ success: true, unlocked: true, signing_key_version: result.signing_key_version });
    } catch (err: any) {
      log.warn('xchat', `[unlock] Juicebox recovery failed: ${err.message}`);
      res.json({ success: true, unlocked: false, reason: err.message });
    }
  } catch (error: any) {
    log.error('xchat', `unlockKeys failed:`, error.message || error);
    const status = error.status || 500;
    const message = error.message?.includes('<!DOCTYPE') ? `${status} Error` : error.message || 'Unknown error';
    res.status(status).json({ error: message });
  }
};

export const reactToMessage = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { message_sequence_id, emoji, remove } = req.body;

    if (!message_sequence_id || !emoji) {
      res.status(400).json({ error: "message_sequence_id and emoji required" });
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const keysResult = await ensureKeys(userId, resolved.client);
    if (!keysResult) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    const convKeyEntry = await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptReaction(
      keysResult.private_key, convKeyEntry.encrypted_conversation_key,
      message_sequence_id, emoji, !!remove,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', keysResult.signing_key_version || '1',
    );

    const response = await resolved.client.chat.sendChatMessage(apiConvId, {
      encoded_message_create_event: payload.encrypted_content,
      encoded_message_event_signature: payload.encoded_event_signature,
      message_id: messageId,
    });

    log.info('xchat', `Sent reaction ${remove ? 'remove' : 'add'} ${emoji} to ${message_sequence_id}`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `reactToMessage failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const editMessage = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { message_sequence_id, text } = req.body;

    if (!message_sequence_id || !text) {
      res.status(400).json({ error: "message_sequence_id and text required" });
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const keysResult = await ensureKeys(userId, resolved.client);
    if (!keysResult) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    const convKeyEntry = await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptEdit(
      keysResult.private_key, convKeyEntry.encrypted_conversation_key,
      message_sequence_id, text,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', keysResult.signing_key_version || '1',
    );

    const response = await resolved.client.chat.sendChatMessage(apiConvId, {
      encoded_message_create_event: payload.encrypted_content,
      encoded_message_event_signature: payload.encoded_event_signature,
      message_id: messageId,
    });

    log.info('xchat', `Edited message ${message_sequence_id}`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `editMessage failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const sendTypingIndicator = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, conversationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Invalid auth" }); return; }

    const apiConvId = toApiConvId(conversationId);
    await resolved.client.chat.sendChatTypingIndicator(apiConvId);
    res.json({ success: true });
  } catch (error: any) {
    log.error('xchat', `sendTypingIndicator failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const registerKeys = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const userId = await resolveUserId(integrationId);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID" });
      return;
    }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.pin) {
      res.status(400).json({ error: "PIN not set" });
      return;
    }

    log.info('xchat', `[register] checking existing public keys for user ${userId}`);
    const { force } = req.body || {};
    try {
      const existingKeys = await resolved.client.users.getUsersPublicKey(userId, {
        'public_key.fields': ['version', 'public_key', 'signing_public_key'] as any,
      }) as any;

      if (existingKeys.data && Array.isArray(existingKeys.data) && existingKeys.data.length > 0 && !force) {
        log.info('xchat', `[register] user ${userId} already has ${existingKeys.data.length} keys registered, skipping enrollment`);
        res.json({ success: true, message: "Keys already registered", keys: existingKeys.data });
        return;
      }
    } catch (checkErr: any) {
      log.warn('xchat', `[register] could not check existing keys: ${checkErr.message}`);
    }

    log.info('xchat', `[register] generating keys for user ${userId}`);

    // Step 1: Generate P-256 key pairs
    const decryptECDH = crypto.createECDH('prime256v1');
    decryptECDH.generateKeys();
    const signingECDH = crypto.createECDH('prime256v1');
    signingECDH.generateKeys();

    const decryptScalar = decryptECDH.getPrivateKey();
    const signingScalar = signingECDH.getPrivateKey();
    const secret = Buffer.concat([decryptScalar, signingScalar]);

    // SPKI encode public keys
    const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const decryptPublicKeySPKI = getPublicKeySPKI(decryptScalar.toString('base64'));
    const signingPublicKeySPKI = getPublicKeySPKI(signingScalar.toString('base64'));

    // Step 2: Publish public keys via REST API
    log.debug('xchat', `[register] publishing public keys to X API`);
    const version = String(Date.now());
    
    // Calculate identity_public_key_signature
    // The X app signs the raw DER bytes of the decrypt public key SPKI with ECDSA-SHA256
    const decryptDerBytes = Buffer.from(decryptPublicKeySPKI, 'base64');
    const identity_public_key_signature = ecdsaSignRaw(signingScalar.toString('base64'), decryptDerBytes);

    let juiceboxConfig: any = null;
    let publishSuccess = false;
    try {
      const pkResp = await resolved.client.chat.addUserPublicKey(userId, {
        version,
        generate_version: true,
        public_key: {
          public_key: decryptPublicKeySPKI,
          signing_public_key: signingPublicKeySPKI,
          identity_public_key_signature,
          registration_method: "CustomPin",
        },
      }) as any;
      log.info('xchat', `[register] public keys published (version=${version})`);
      juiceboxConfig = pkResp.data?.juicebox_config;
      publishSuccess = true;
    } catch (pkErr: any) {
      log.warn('xchat', `[register] public key publish failed (${pkErr.status || 'unknown'}): ${pkErr.message}`);
    }

    if (!publishSuccess) {
      res.status(500).json({ error: "Failed to publish public keys to X. Keys were NOT saved." });
      return;
    }

    // Step 3: Enroll in Juicebox if config available
    if (juiceboxConfig) {
      try {
        log.info('xchat', `[register] enrolling keys in Juicebox for user ${userId}`);
        await juiceboxRegister(xchat.pin, secret, JSON.stringify(juiceboxConfig), userId, juiceboxLogger);
        log.info('xchat', `[register] Juicebox enrollment successful`);
      } catch (jbErr: any) {
        log.error('xchat', `[register] Juicebox enrollment failed:`, jbErr.message || jbErr);
        // We still save the keys locally so the user can try again or use them
      }
    } else {
      // If POST didn't return it, try to fetch it
      try {
        log.debug('xchat', `[register] fetching juicebox_config from public_keys endpoint`);
        const pkData = await resolved.client.users.getUsersPublicKey(userId, {
          'public_key.fields': ['version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
        }) as any;
        const freshConfig = pkData.data?.find((k: any) => k.version === version)?.juicebox_config;
        if (freshConfig) {
          log.info('xchat', `[register] enrolling keys in Juicebox (fresh config) for user ${userId}`);
          await juiceboxRegister(xchat.pin, secret, JSON.stringify(freshConfig), userId, juiceboxLogger);
          log.info('xchat', `[register] Juicebox enrollment successful`);
        }
      } catch (fetchErr: any) {
        log.warn('xchat', `[register] could not fetch juicebox_config for enrollment: ${fetchErr.message}`);
      }
    }

    // Step 4: Store keys locally
    const keysJson = JSON.stringify({
      signingKeyB64: signingScalar.toString('base64'),
      decryptKeyB64: decryptScalar.toString('base64'),
      keyVersion: version,
    });

    await userXChatStorage.save({
      ...xchat,
      private_key: keysJson,
      signing_key_version: version,
    });

    log.info('xchat', `[register] keys generated and cached for user ${userId}`);
    res.json({ success: true, registered: true, version });
  } catch (error: any) {
    log.error('xchat', `registerKeys failed:`, error.message || error);
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

export const changePin = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;
    const { newPin } = req.body;

    if (!newPin || typeof newPin !== 'string' || newPin.length < 4) {
      res.status(400).json({ error: "newPin must be at least 4 characters" });
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Integration not found or invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    // Fetch fresh juicebox_config (tokens expire)
    const pkData = await resolved.client.users.getUsersPublicKey(userId, {
      'public_key.fields': ['version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
    }) as any;
    const raw = Array.isArray(pkData?.data) ? pkData.data[pkData.data.length - 1] : pkData?.data;
    if (!raw?.public_key) {
      res.status(400).json({ error: "User is not enrolled in XChat. Use /register instead." });
      return;
    }
    const jbConfig = raw?.juicebox_config ?? raw?.token_map;
    if (!jbConfig) {
      res.status(500).json({ error: "Could not fetch juicebox_config" });
      return;
    }

    // Build config JSON in the format register()/recover() expects
    const tokens: Record<string, string> = {};
    if (jbConfig.token_map && Array.isArray(jbConfig.token_map)) {
      for (const t of jbConfig.token_map) tokens[t.key] = t.value?.token ?? t.value;
    }
    const configJson = JSON.stringify({ sdk_config: jbConfig.key_store_token_map_json, tokens, max_guess_count: jbConfig.max_guess_count });

    // Get the secret — use ensureKeys (will recover with stored PIN if needed)
    const keysResult = await ensureKeys(userId, resolved.client);
    if (!keysResult) {
      res.status(400).json({ error: "Keys not available. Set PIN and unlock first." });
      return;
    }
    const keys = JSON.parse(keysResult.private_key);
    const secret = Buffer.concat([
      Buffer.from(keys.decryptKeyB64, 'base64'),
      Buffer.from(keys.signingKeyB64, 'base64'),
    ]);

    // Re-register with new PIN
    log.info('xchat', `[changePin] re-registering with new PIN for user ${userId}`);
    await juiceboxRegister(newPin, secret, configJson, userId, juiceboxLogger);

    // Update local PIN
    const updated = await userXChatStorage.load(userId);
    await userXChatStorage.save({ ...updated!, pin: newPin });

    log.info('xchat', `[changePin] PIN changed successfully for user ${userId}`);
    res.json({ success: true });
  } catch (error: any) {
    log.error('xchat', `changePin failed:`, error.message || error);
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};
