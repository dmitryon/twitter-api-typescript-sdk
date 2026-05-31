import { Request, Response } from "express";
import { resolveAuth, mediaCache, sseResponse, integrationStorage, accessTokenStorage } from "./handler-utils";
import { rest } from "twitter-api-sdk";
import { UserPublicKeyStorage, ConversationKeyStorage, UserXChatStorage, JuiceboxCallLogger } from "../storage";
import { log } from "../logger";
import { toCanonicalConvId, toApiConvId, extractRecipientId } from "../xchat/xchat-utils";
import { encryptMessage, encryptReaction, encryptEdit, unwrapConversationKey, secretboxDecrypt, wrapConversationKey, getPublicKeyFromScalar, spkiToRawPublicKey } from "../xchat/chat-crypto";
import { extractContentsFromMessageEvent, decodeMessageEntryHolder } from "../xchat/chat-thrift";
import { recover } from "../xchat/juicebox/client";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { __dirname } from "../esm-utils";

const userPublicKeyStorage = new UserPublicKeyStorage();
const conversationKeyStorage = new ConversationKeyStorage();
const userXChatStorage = new UserXChatStorage();
const juiceboxLogger = new JuiceboxCallLogger();

// Ensure storage directories exist
Promise.all([userPublicKeyStorage.init(), conversationKeyStorage.init(), userXChatStorage.init(), juiceboxLogger.init()]).catch(() => {});

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
    const { id } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const response = await resolved.client.chat.getChatConversations({
      "chat_conversation.fields": ["id", "type", "participant_ids", "member_ids", "admin_ids", "group_name", "created_at", "updated_at"],
    });

    log.debug('xchat', `Fetched conversations for integration ${id} (${response.data?.length || 0})`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `getXChatConversations failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const getXChatMessages = async (req: Request, res: Response) => {
  try {
    const { id, conversationId } = req.params;
    const { auth: authType, pagination_token } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);

    // Resolve user ID and keys for decryption
    const userId = await resolveUserId(id);
    const xchat = userId ? await userXChatStorage.load(userId) : null;
    const keys = xchat?.private_key ? JSON.parse(xchat.private_key) : null;

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

      // Extract conversation key from response metadata if not already cached
      if (!convKey && keys?.decryptKeyB64 && (eventsResp as any).meta?.conversation_key_events?.length) {
        
        for (const keyEventB64 of (eventsResp as any).meta.conversation_key_events) {
          try {
            const keyBuf = Buffer.from(keyEventB64, 'base64');
            // Search for our userId as a thrift string, then read encrypted_conversation_key
            let searchPos = 0;
            while (true) {
              const idx = keyBuf.indexOf(userId!, searchPos);
              if (idx === -1) break;
              if (idx >= 4 && keyBuf.readInt32BE(idx - 4) === userId!.length) {
                const pos = idx + userId!.length;
                if (pos < keyBuf.length - 7 && keyBuf[pos] === 11 && keyBuf.readInt16BE(pos + 1) === 2) {
                  const len = keyBuf.readInt32BE(pos + 3);
                  const encKey = keyBuf.subarray(pos + 7, pos + 7 + len).toString('utf8');
                  convKey = unwrapConversationKey(encKey, keys.decryptKeyB64);
                  // Cache it
                  await conversationKeyStorage.save({ id: canonicalId, encrypted_conversation_key: encKey, key_version: '', cached_at: new Date().toISOString() });
                  log.debug('xchat', `getXChatMessages: extracted conversation key from API response`);
                  break;
                }
              }
              searchPos = idx + 1;
            }
            if (convKey) break;
          } catch {}
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
        if (convKey && event.encoded_event) {
          try {
            const eventBuf = Buffer.from(event.encoded_event, 'base64');
            const contents = extractContentsFromMessageEvent(eventBuf);
            if (contents) {
              const plaintext = await secretboxDecrypt(contents, convKey);
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
    const { id, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { text, media_hash_key, conversation_token, key_version, reply_to } = req.body;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const userId = await resolveUserId(id);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID for integration" });
      return;
    }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.pin) {
      res.status(400).json({ error: "X Chat PIN not set. Please configure your PIN first." });
      return;
    }

    const message_id = crypto.randomUUID();
    const apiConvId = toApiConvId(conversationId);
    let encoded_message_create_event: string;
    let encoded_message_event_signature: string | undefined;

    log.debug('xchat', `[send] step 1: checking conversation key for ${conversationId}`);
    const convKeyId = toCanonicalConvId(conversationId);
    const convKeyEntry = await conversationKeyStorage.load(convKeyId);
    const encryptedConvKey = convKeyEntry?.encrypted_conversation_key ?? req.body.encrypted_conversation_key;

    if (xchat.private_key && encryptedConvKey) {
      log.debug('xchat', `[send] step 2: using cached conversation key (version=${convKeyEntry?.key_version})`);
      
      try {
        const payload = await encryptMessage(
          xchat.private_key,
          encryptedConvKey,
          text,
          message_id,
          userId,
          convKeyId,
          key_version ?? convKeyEntry?.key_version ?? '1',
          xchat.signing_key_version ?? '1',
          reply_to,
        );
        encoded_message_create_event = payload.encrypted_content;
        encoded_message_event_signature = payload.encoded_event_signature;
        log.debug('xchat', `[send] step 3: message encrypted (secretbox + ECDSA signed)`);
      } catch (encErr: any) {
        log.error('xchat', `[send] encryption failed: ${encErr.message}`);
        res.status(500).json({ error: `Encryption failed: ${encErr.message}` });
        return;
      }
    } else if (xchat.private_key && !encryptedConvKey) {
      log.info('xchat', `[send] step 2: no conversation key found, initializing new conversation`);
      try {
        
        const keys = JSON.parse(xchat.private_key!);

        // Generate a new 32-byte conversation key
        const convKey = crypto.randomBytes(32);
        const keyVersion = String(Date.now());
        log.debug('xchat', `[send] step 2a: generated conversation key (version=${keyVersion})`);

        // Get own public key from our decrypt key scalar
        const ownPubKeyB64 = getPublicKeyFromScalar(keys.decryptKeyB64);
        log.debug('xchat', `[send] step 2b: derived own public key from decrypt scalar`);

        // Get recipient's public key
        const recipientId = extractRecipientId(conversationId, userId);
        log.debug('xchat', `[send] step 2c: fetching recipient public key for ${recipientId}`);
        const recipientPkResp = await resolved.client.users.getUsersPublicKey(recipientId) as any;
        const recipientEntry = Array.isArray(recipientPkResp?.data) ? recipientPkResp.data[recipientPkResp.data.length - 1] : recipientPkResp?.data;
        if (!recipientEntry?.public_key) {
          res.status(400).json({ error: "Could not fetch recipient's public key" });
          return;
        }
        log.debug('xchat', `[send] step 2c: got recipient public key (version=${recipientEntry.version})`);

        // Wrap conversation key for both participants
        const ownWrapped = wrapConversationKey(convKey, ownPubKeyB64);
        const recipientRawPubKey = spkiToRawPublicKey(recipientEntry.public_key);
        const recipientWrapped = wrapConversationKey(convKey, recipientRawPubKey);
        log.debug('xchat', `[send] step 2d: wrapped conversation key for both participants`);

        // Initialize conversation keys via API
        log.debug('xchat', `[send] step 2e: calling initializeChatConversationKeys for ${recipientId}`);
        try {
          await resolved.client.chat.initializeChatConversationKeys(recipientId, {
            conversation_key_version: keyVersion,
            conversation_participant_keys: [
              { user_id: userId, encrypted_conversation_key: ownWrapped, public_key_version: keys.keyVersion },
              { user_id: recipientId, encrypted_conversation_key: recipientWrapped, public_key_version: recipientEntry.version },
            ],
          });
          log.info('xchat', `[send] step 2e: conversation keys initialized successfully`);
        } catch (keyInitErr: any) {
          log.warn('xchat', `[send] step 2e: key initialization endpoint failed (${keyInitErr.status || 'unknown'}), proceeding without it`);
        }

        // Cache the wrapped key for future use
        await conversationKeyStorage.save({
          id: convKeyId,
          encrypted_conversation_key: ownWrapped,
          key_version: keyVersion,
          cached_at: new Date().toISOString(),
        });
        log.debug('xchat', `[send] step 2f: conversation key cached`);

        // Encrypt the message with the new key
        
        const payload = await encryptMessage(
          xchat.private_key!, ownWrapped, text,
          message_id, userId, convKeyId,
          keyVersion, keys.keyVersion,
          reply_to,
        );
        encoded_message_create_event = payload.encrypted_content;
        encoded_message_event_signature = payload.encoded_event_signature;
        log.debug('xchat', `[send] step 3: message encrypted with new conversation key`);
      } catch (initErr: any) {
        log.error('xchat', `[send] key initialization failed: ${initErr.message}`);
        res.status(500).json({ error: `Key initialization failed: ${initErr.message}` });
        return;
      }
    } else {
      res.status(400).json({ error: "Private key not available. Please unlock keys first." });
      return;
    }

    const response = await resolved.client.chat.sendChatMessage(apiConvId, {
      encoded_message_create_event,
      ...(encoded_message_event_signature ? { encoded_message_event_signature } : {}),
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
    const { id, userId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
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
    const { id } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const { media, conversation_id } = req.body;
    const mediaBuffer = Buffer.from(media, 'base64');
    const sendEvent = sseResponse(res);

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
    const { id } = req.params;
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

    const resolved = await resolveAuth(id, authType as string);
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

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());

    await mediaCache.set(cacheKey, buffer, contentType);

    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (error: any) {
    log.error('xchat', `Media proxy failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

export const updateXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { pin, private_key, signing_key_version, conversation_key } = req.body;

    const userId = await resolveUserId(id);
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

    log.info('xchat', `Updated xchat settings for user ${userId} (integration ${id})`);
    const xchat = await userXChatStorage.load(userId);
    res.json({ success: true, xchat: { has_pin: !!xchat?.pin, has_private_key: !!xchat?.private_key } });
  } catch (error: any) {
    log.error('xchat', `updateXChatSettings failed:`, error.message || error);
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

export const getXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { auth: authType } = req.query;

    const userId = await resolveUserId(id);
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
        const resolved = await resolveAuth(id, authType as string || 'oauth2');
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

export const unlockKeys = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    // Step 1: resolve user ID
    const userId = await resolveUserId(id);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID — ensure OAuth2 is connected" });
      return;
    }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.pin) {
      res.status(400).json({ error: "PIN not set" });
      return;
    }
    log.debug('xchat', `[unlock] step 1: resolved user_id=${userId}`);

    // Step 2: always fetch fresh public keys (tokens in juicebox_config expire)
    log.debug('xchat', `[unlock] step 2: fetching public keys from API for user ${userId}`);
    const pkData = await rest({
      auth: resolved.authClient,
      endpoint: `/2/users/${userId}/public_keys`,
      params: { 'public_key.fields': 'version,public_key,signing_public_key,juicebox_config' },
      method: 'GET',
    }) as any;
    const raw = Array.isArray(pkData?.data) ? pkData.data[pkData.data.length - 1] : pkData?.data;
    if (!raw) {
      res.status(500).json({ error: "No public key data returned" });
      return;
    }
    const keyEntry = {
      id: userId,
      public_key: raw.public_key,
      signing_public_key: raw.signing_public_key,
      version: raw.version,
      juicebox_config: raw.juicebox_config ?? raw.token_map,
      cached_at: new Date().toISOString(),
    };
    await userPublicKeyStorage.save(keyEntry);
    log.debug('xchat', `[unlock] step 2: public keys fetched (version=${keyEntry.version})`);
    if (!keyEntry) {
      res.status(500).json({ error: "No public key data returned" });
      return;
    }
    const signingKeyVersion = String(keyEntry.version ?? '');
    log.debug('xchat', `[unlock] step 2: signing_key_version=${signingKeyVersion}`);

    // Step 3: attempt Juicebox unlock
    log.info('xchat', `[unlock] step 3: starting Juicebox recovery`);
    
    try {
      // Build config JSON in the format recover() expects
      const jb = keyEntry.juicebox_config as any;
      const tokens: Record<string, string> = {};
      if (jb.token_map && Array.isArray(jb.token_map)) {
        for (const t of jb.token_map) tokens[t.key] = t.value?.token ?? t.value;
      }
      const configJson = JSON.stringify({ sdk_config: jb.key_store_token_map_json, tokens, max_guess_count: jb.max_guess_count });

      const secret = await recover(xchat.pin, configJson, userId, juiceboxLogger);
      // The recovered secret contains the raw P-256 key material
      // Format: decrypt_key(32) || signing_key(32) (per Go's splitRawRecoveredSecret)
      const decryptKeyB64 = Buffer.from(secret.slice(0, 32)).toString('base64');
      const signingKeyB64 = secret.length >= 64
        ? Buffer.from(secret.slice(32, 64)).toString('base64')
        : decryptKeyB64;

      await userXChatStorage.save({
        ...xchat,
        private_key: JSON.stringify({ signingKeyB64, decryptKeyB64, keyVersion: signingKeyVersion }),
        signing_key_version: signingKeyVersion,
      });
      log.info('xchat', `[unlock] step 3: private key recovered and cached for user ${userId}`);
      res.json({ success: true, unlocked: true, signing_key_version: signingKeyVersion });
    } catch (unlockErr: any) {
      // Store signing_key_version even if unlock fails
      await userXChatStorage.save({ ...xchat, signing_key_version: signingKeyVersion });
      log.warn('xchat', `[unlock] step 3: Juicebox recovery failed — ${unlockErr.message}`);
      res.json({ success: true, unlocked: false, reason: unlockErr.message, signing_key_version: signingKeyVersion });
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
    const { id, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { message_sequence_id, emoji, remove } = req.body;

    if (!message_sequence_id || !emoji) {
      res.status(400).json({ error: "message_sequence_id and emoji required" });
      return;
    }

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) { res.status(400).json({ error: "Invalid auth" }); return; }

    const userId = await resolveUserId(id);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.private_key) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    const convKeyEntry = await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptReaction(
      xchat.private_key, convKeyEntry.encrypted_conversation_key,
      message_sequence_id, emoji, !!remove,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', xchat.signing_key_version || '1',
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
    const { id, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { message_sequence_id, text } = req.body;

    if (!message_sequence_id || !text) {
      res.status(400).json({ error: "message_sequence_id and text required" });
      return;
    }

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) { res.status(400).json({ error: "Invalid auth" }); return; }

    const userId = await resolveUserId(id);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.private_key) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    const convKeyEntry = await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptEdit(
      xchat.private_key, convKeyEntry.encrypted_conversation_key,
      message_sequence_id, text,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', xchat.signing_key_version || '1',
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
    const { id, conversationId } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
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
    const { id } = req.params;
    const { auth: authType } = req.query;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    const userId = await resolveUserId(id);
    if (!userId) {
      res.status(400).json({ error: "Could not resolve user ID" });
      return;
    }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat?.pin) {
      res.status(400).json({ error: "PIN not set" });
      return;
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
    const decryptPublicKeySPKI = Buffer.concat([spkiPrefix, decryptECDH.getPublicKey()]).toString('base64');
    const signingPublicKeySPKI = Buffer.concat([spkiPrefix, signingECDH.getPublicKey()]).toString('base64');

    // Step 2: Publish public keys via REST API
    log.debug('xchat', `[register] publishing public keys to X API`);
    const version = String(Date.now());
    try {
      // Use the REST API endpoint for adding public keys
      await rest({
        auth: resolved.authClient,
        endpoint: `/2/users/${userId}/public_keys`,
        method: 'POST',
        request_body: {
          public_key: decryptPublicKeySPKI,
          signing_public_key: signingPublicKeySPKI,
          version,
        },
      });
      log.info('xchat', `[register] public keys published (version=${version})`);
    } catch (pkErr: any) {
      log.warn('xchat', `[register] public key publish failed (${pkErr.status || 'unknown'}): ${pkErr.message}`);
      // Continue anyway — keys may already be registered or endpoint may not exist
    }

    // Step 3: Store keys locally (skip Juicebox registration for now if tokens unavailable)
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
