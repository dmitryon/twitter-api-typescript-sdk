import { Request, Response } from "express";
import { resolveAuth, mediaCache, sseResponse, integrationStorage, accessTokenStorage } from "./handler-utils";
import { rest } from "twitter-api-sdk";
import { UserPublicKeyStorage, ConversationKeyStorage, UserXChatStorage, JuiceboxCallLogger, KeyRecoveryHistoryStorage, KeyPair } from "../storage";
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
  getPublicKeySPKI,
  verifyMessageSignature
} from "../xchat/chat-crypto";
import { extractContentsFromMessageEvent, decodeMessageEntryHolder } from "../xchat/chat-thrift";
import { decode } from "../xchat/thrift-codec";
import { MessageEventSchema } from "../xchat/thrift-models";
import { recover, register as juiceboxRegister } from "../xchat/juicebox/client";
import { secretstreamDecryptAsync, secretstreamEncryptAsync } from "../xchat/secretstream";
import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
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

/** Result of ensureKeys — all recovered key versions + the latest for signing. */
interface UserKeys {
  /** All private keys indexed by version */
  allKeys: Record<string, KeyPair>;
  /** The latest key version (used for signing outgoing messages) */
  latestVersion: string;
  /** The latest key pair (convenience) */
  latest: KeyPair;
}

/** Try to unwrap a conversation key using the specified user key version, falling back to all keys. */
function tryUnwrapConversationKey(encryptedConvKey: string, userKeys: UserKeys, publicKeyVersion?: string): { key: Buffer; decryptKeyB64: string; version: string } | null {
  // If a specific version is hinted, try it first
  if (publicKeyVersion && userKeys.allKeys[publicKeyVersion]) {
    try {
      const kp = userKeys.allKeys[publicKeyVersion];
      return { key: unwrapConversationKey(encryptedConvKey, kp.decryptKeyB64), decryptKeyB64: kp.decryptKeyB64, version: publicKeyVersion };
    } catch {}
  }
  // Brute-force all keys
  for (const [ver, kp] of Object.entries(userKeys.allKeys)) {
    if (ver === publicKeyVersion) continue; // already tried
    try {
      return { key: unwrapConversationKey(encryptedConvKey, kp.decryptKeyB64), decryptKeyB64: kp.decryptKeyB64, version: ver };
    } catch {}
  }
  return null;
}

/** Resolve the latest conversation key from the API's conversation_key_events. */
async function resolveLatestConversationKey(
  client: any, apiConvId: string, canonicalId: string, userId: string, userKeys: UserKeys
): Promise<{ encryptedConvKey: string; keyVersion: string } | null> {
  try {
    const eventsResp = await client.chat.getChatConversationEvents(apiConvId, { max_results: 1 }) as any;
    const keyEvents = eventsResp.meta?.conversation_key_events || [];
    // Iterate all key events and pick the one with the highest version
    let best: { encryptedConvKey: string; keyVersion: string } | null = null;
    for (const keyEventB64 of keyEvents) {
      try {
        const keyBuf = Buffer.from(keyEventB64, 'base64');
        const keyEvent = decode(keyBuf, MessageEventSchema);
        const kce = keyEvent.detail?.conversationKeyChangeEvent;
        if (!kce) continue;
        const ours = (kce.conversation_participant_keys || []).find((pk: any) => pk.user_id === userId);
        if (!ours?.encrypted_conversation_key) continue;
        // Verify we can actually unwrap it (use public_key_version hint from participant entry)
        if (!tryUnwrapConversationKey(ours.encrypted_conversation_key, userKeys, ours.public_key_version)) continue;
        const ver = kce.conversation_key_version || '';
        if (!best || Number(ver) > Number(best.keyVersion)) {
          best = { encryptedConvKey: ours.encrypted_conversation_key, keyVersion: ver };
        }
      } catch {}
    }
    if (best) {
      await conversationKeyStorage.save({ id: canonicalId, encrypted_conversation_key: best.encryptedConvKey, key_version: best.keyVersion, cached_at: new Date().toISOString() });
    }
    return best;
  } catch {
    return null;
  }
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
    const userKeys = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;

    // Get conversation key
    let convKey: Buffer | null = null;
    if (userKeys) {
      const cached = await conversationKeyStorage.load(canonicalId);
      if (cached?.encrypted_conversation_key) {
        const result = tryUnwrapConversationKey(cached.encrypted_conversation_key, userKeys);
        convKey = result?.key ?? null;
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
      if (userKeys && (eventsResp as any).meta?.conversation_key_events?.length) {
        
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
              const result = tryUnwrapConversationKey(ours.encrypted_conversation_key, userKeys, ours.public_key_version);
              if (!result) continue;
              convKeysByVersion.set(keyVersion, result.key);
              if (!convKey) {
                convKey = result.key;
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
              // Verify message signature
              const sigValid = verifyMessageSignature(fullEvent);
              if (sigValid === false) {
                log.warn('xchat', `getXChatMessages: ⚠️ INVALID signature on event ${event.id} from ${event.sender_id}`);
              }
              msg.signature_valid = sigValid;

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
                    if (decoded.message.forwarded_message) msg.forwarded_message = decoded.message.forwarded_message;
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

    const userKeys = await ensureKeys(userId, resolved.client);
    if (!userKeys) {
      res.status(400).json({ error: "Keys not available. Set PIN and try again." });
      return;
    }

    const message_id = crypto.randomUUID();
    const apiConvId = toApiConvId(conversationId);
    // For 1:1 chats, ensure convKeyId is the full canonical format (smallerId:largerId)
    // When starting a new chat, conversationId may be just the recipient's user ID
    let convKeyId = toCanonicalConvId(conversationId);
    if (!convKeyId.startsWith('g') && !convKeyId.includes(':')) {
      const ids = [userId, convKeyId].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      convKeyId = `${ids[0]}:${ids[1]}`;
    }

    // Resolve missing conversation_token, key_version, and conversation key from cache or API
    const convKeyEntry = await conversationKeyStorage.load(convKeyId);
    let encryptedConvKey = encrypted_conversation_key || convKeyEntry?.encrypted_conversation_key;
    if (!key_version && convKeyEntry?.key_version) key_version = convKeyEntry.key_version;

    if (!conversation_token || !encryptedConvKey || !key_version) {
      log.debug('xchat', `[send] fetching events to resolve missing params (token=${!!conversation_token}, key=${!!encryptedConvKey}, version=${!!key_version})`);
      try {
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
              if (!tryUnwrapConversationKey(ours.encrypted_conversation_key, userKeys, ours.public_key_version)) continue;
              const ver = kce.conversation_key_version || '';
              // Always pick the latest (highest) key version
              if (!key_version || Number(ver) > Number(key_version)) {
                encryptedConvKey = ours.encrypted_conversation_key;
                key_version = ver;
              }
            } catch {}
          }
          if (encryptedConvKey && key_version) {
            await conversationKeyStorage.save({ id: convKeyId, encrypted_conversation_key: encryptedConvKey, key_version: key_version || '', cached_at: new Date().toISOString() });
          }
        }
      } catch (eventsErr: any) {
        // New conversation — no events exist yet, proceed to key initialization
        log.debug('xchat', `[send] getChatConversationEvents failed (${eventsErr.status || 'unknown'}), likely new conversation`);
      }
    }

    // Verify we can actually unwrap the cached key with our current private key
    let unwrapResult: { key: Buffer; decryptKeyB64: string; version: string } | null = null;
    if (encryptedConvKey) {
      unwrapResult = tryUnwrapConversationKey(encryptedConvKey, userKeys);
      if (!unwrapResult) {
        log.warn('xchat', `[send] cached conversation key cannot be unwrapped (likely wrapped for old key version), re-initializing`);
        encryptedConvKey = undefined;
        key_version = undefined;
      }
    }

    if (!encryptedConvKey) {
      // No key exchange has happened yet — initialize conversation keys
      log.info('xchat', `[send] no conversation key found, initializing key exchange for ${apiConvId}`);

      // Determine participant IDs
      let participantIds: string[];
      if (convKeyId.startsWith('g')) {
        // Group: fetch conversation to get member list
        const convResp = await resolved.client.chat.getChatConversation(apiConvId, {
          "chat_conversation.fields": ["member_ids", "participant_ids"],
        }) as any;
        const members = convResp.data?.member_ids || convResp.data?.participant_ids || [];
        participantIds = [...new Set([userId, ...members])];
      } else {
        // 1:1: extract from conversation ID
        const recipientId = extractRecipientId(convKeyId, userId);
        participantIds = recipientId === userId ? [userId] : [userId, recipientId];
      }

      // Generate random conversation key
      const newConvKey = crypto.randomBytes(32);
      const newKeyVersion = String(Date.now());

      // Wrap for each participant using their public key
      const conversationParticipantKeys: { user_id: string; encrypted_conversation_key: string; public_key_version: string }[] = [];
      for (const pid of participantIds) {
        // Always fetch fresh public keys to avoid wrapping with a stale/old key version
        const pkResp = await resolved.client.users.getUsersPublicKey(pid) as any;
        const entry = Array.isArray(pkResp?.data) ? pkResp.data[pkResp.data.length - 1] : pkResp?.data;
        if (!entry?.public_key) {
          res.status(400).json({ error: `Participant ${pid} has no public key (not enrolled in X Chat)` });
          return;
        }
        await userPublicKeyStorage.save({ id: pid, public_key: entry.public_key, signing_public_key: entry.signing_public_key, version: entry.public_key_version, juicebox_config: entry.juicebox_config ?? entry.token_map, cached_at: new Date().toISOString() });
        const wrapped = wrapConversationKey(newConvKey, spkiToRawPublicKey(entry.public_key));
        conversationParticipantKeys.push({ user_id: pid, encrypted_conversation_key: wrapped, public_key_version: entry.public_key_version || '' });
      }

      // Initialize keys on the API
      const recipientId = extractRecipientId(convKeyId, userId);
      await resolved.client.chat.addConversationKeys(
        convKeyId.startsWith('g') ? apiConvId : recipientId,
        {
          conversation_key_version: newKeyVersion,
          conversation_participant_keys: conversationParticipantKeys,
        }
      );

      // Use our own wrapped key for encryption
      const ours = conversationParticipantKeys.find(pk => pk.user_id === userId)!;
      encryptedConvKey = ours.encrypted_conversation_key;
      key_version = newKeyVersion;
      await conversationKeyStorage.save({ id: convKeyId, encrypted_conversation_key: encryptedConvKey, key_version: newKeyVersion, cached_at: new Date().toISOString() });
      log.info('xchat', `[send] initialized conversation key (version=${newKeyVersion}, participants=${participantIds.length})`);
    }

    log.debug('xchat', `[send] encrypting message (key_version=${key_version})`);
    // Use the decrypt key that can actually unwrap this conversation key,
    // but always sign with the latest signing key
    const sendKeys = {
      signingKeyB64: userKeys.latest.signingKeyB64,
      decryptKeyB64: unwrapResult?.decryptKeyB64 ?? userKeys.latest.decryptKeyB64,
    };
    const payload = await encryptMessage(
      JSON.stringify(sendKeys),
      encryptedConvKey,
      text,
      message_id,
      userId,
      convKeyId,
      key_version ?? '1',
      userKeys.latestVersion,
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
    const userKeys = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;

    let mediaBuffer: Buffer;
    if (userKeys) {
      const convKeyEntry = await conversationKeyStorage.load(canonicalId);
      if (convKeyEntry?.encrypted_conversation_key) {
        const result = tryUnwrapConversationKey(convKeyEntry.encrypted_conversation_key, userKeys);
        if (result) {
          sendEvent({ step: 'encrypting', detail: `${plaintextBuffer.length} bytes` });
          mediaBuffer = await secretstreamEncryptAsync(plaintextBuffer, result.key);
          log.debug('xchat', `Media encrypted: ${plaintextBuffer.length} → ${mediaBuffer.length} bytes`);
        } else {
          log.warn('xchat', `Cannot unwrap conversation key for ${canonicalId}, uploading unencrypted`);
          mediaBuffer = plaintextBuffer;
        }
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

    // Try serving from disk cache with Range support
    const cachedMeta = await mediaCache.getMeta(cacheKey);
    if (cachedMeta) {
      return serveFileWithRanges(req, res, cachedMeta.filePath, cachedMeta.contentType, cachedMeta.size);
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
    const userKeys = userId ? await ensureKeys(userId, resolved.client).catch(() => null) : null;

    let decryptedBuffer: Buffer;
    if (userKeys) {
      const convKeyEntry = await conversationKeyStorage.load(canonicalId);
      if (convKeyEntry?.encrypted_conversation_key) {
        const result = tryUnwrapConversationKey(convKeyEntry.encrypted_conversation_key, userKeys);
        if (result) {
          try {
            decryptedBuffer = await secretstreamDecryptAsync(encryptedBuffer, result.key);
          } catch (decErr: any) {
            log.warn('xchat', `Media decryption failed for ${media_hash_key}: ${decErr.message}`);
            decryptedBuffer = encryptedBuffer;
          }
        } else {
          log.warn('xchat', `Cannot unwrap conversation key for ${canonicalId}, serving raw media`);
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

    // Serve with Range support
    const meta = await mediaCache.getMeta(cacheKey);
    if (meta) {
      return serveFileWithRanges(req, res, meta.filePath, meta.contentType, meta.size);
    }
    // Fallback: send buffer directly
    res.set('Content-Type', contentType);
    res.set('Content-Length', String(decryptedBuffer.length));
    res.set('Accept-Ranges', 'bytes');
    res.send(decryptedBuffer);
  } catch (error: any) {
    log.error('xchat', `Media proxy failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

/** Serve a file from disk with HTTP Range request support. */
function serveFileWithRanges(req: Request, res: Response, filePath: string, contentType: string, fileSize: number) {
  const range = req.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      res.status(206);
      res.set({
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(fileSize),
    'Accept-Ranges': 'bytes',
  });
  createReadStream(filePath).pipe(res);
}

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
    const hasPrivateKey = !!(xchat?.private_keys && Object.keys(xchat.private_keys).length > 0) || !!xchat?.private_key;

    // Build per-key status
    let keyVersions: { version: string; unlocked: boolean; has_pin: boolean }[] = [];
    if (xchat?.private_keys) {
      for (const v of Object.keys(xchat.private_keys).sort()) {
        keyVersions.push({ version: v, unlocked: true, has_pin: !!(xchat.pins?.[v] || xchat.pin) });
      }
    }

    // Check server for published versions we haven't recovered yet
    let serverVersions: string[] = [];
    if (hasPin) {
      try {
        const resolved = await resolveAuth(integrationId, authType as string || 'oauth2');
        if (resolved) {
          const pkResp = await resolved.client.users.getUsersPublicKey(userId, {
            'public_key.fields': ['public_key_version', 'public_key'] as any,
          }) as any;
          const entries = Array.isArray(pkResp?.data) ? pkResp.data : pkResp?.data ? [pkResp.data] : [];
          for (const e of entries) {
            const v = String(e.public_key_version ?? '');
            if (!v) continue;
            serverVersions.push(v);
            if (!keyVersions.find(k => k.version === v)) {
              keyVersions.push({ version: v, unlocked: false, has_pin: !!(xchat?.pins?.[v] || xchat?.pin) });
            }
          }
        }
      } catch {}
    }

    keyVersions.sort((a, b) => a.version.localeCompare(b.version));

    const needsRegistration = hasPin && !hasPrivateKey && serverVersions.length === 0;

    res.json({
      xchat: { has_pin: hasPin, has_private_key: hasPrivateKey, needs_registration: needsRegistration, user_id: userId, key_versions: keyVersions },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

/** Ensure user's private keys are available — from cache or by recovering ALL versions from Juicebox. */
async function ensureKeys(userId: string, client: any, { force = false } = {}): Promise<UserKeys | null> {
  const xchat = await userXChatStorage.load(userId);

  // Return cached keys if available (migrate old format)
  if (!force && xchat?.private_keys && Object.keys(xchat.private_keys).length > 0) {
    const versions = Object.keys(xchat.private_keys).sort((a, b) => Number(a) - Number(b));
    const latestVersion = versions[versions.length - 1];
    return { allKeys: xchat.private_keys, latestVersion, latest: xchat.private_keys[latestVersion] };
  }
  if (!force && xchat?.private_key) {
    // Migrate old single-key format
    const parsed = JSON.parse(xchat.private_key);
    const version = parsed.keyVersion || xchat.signing_key_version || 'unknown';
    const kp: KeyPair = { signingKeyB64: parsed.signingKeyB64, decryptKeyB64: parsed.decryptKeyB64 };
    return { allKeys: { [version]: kp }, latestVersion: version, latest: kp };
  }
  if (!xchat?.pin) return null;

  // Fetch all key versions with juicebox_config
  const pkData = await client.users.getUsersPublicKey(userId, {
    'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
  }) as any;
  const entries = Array.isArray(pkData?.data) ? pkData.data : pkData?.data ? [pkData.data] : [];
  if (entries.length === 0) return null;

  const allKeys: Record<string, KeyPair> = { ...(xchat.private_keys || {}) };

  // Recover each version that we don't already have
  for (const entry of entries) {
    const version = String(entry.public_key_version ?? '');
    if (!version || allKeys[version]) continue;
    const jbConfig = entry.juicebox_config ?? entry.token_map;
    if (!jbConfig?.key_store_token_map_json) continue;

    // Use per-version PIN if available, otherwise fall back to default PIN
    const pin = xchat.pins?.[version] || xchat.pin!;
    try {
      const configJson = buildJuiceboxConfigJson(jbConfig);
      const secret = await recover(pin, configJson, userId, juiceboxLogger);
      const decryptKeyB64 = Buffer.from(secret.slice(0, 32)).toString('base64');
      const signingKeyB64 = secret.length >= 64 ? Buffer.from(secret.slice(32, 64)).toString('base64') : decryptKeyB64;
      allKeys[version] = { signingKeyB64, decryptKeyB64 };
      log.info('xchat', `[ensureKeys] recovered key version ${version} for user ${userId}`);
    } catch (err: any) {
      log.warn('xchat', `[ensureKeys] failed to recover version ${version}: ${err.message}`);
      await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: false, error: `version ${version}: ${err.message}` });
    }
  }

  if (Object.keys(allKeys).length === 0) return null;

  // Persist all recovered keys
  const versions = Object.keys(allKeys).sort((a, b) => Number(a) - Number(b));
  const latestVersion = versions[versions.length - 1];
  await userXChatStorage.save({ ...xchat, private_keys: allKeys, signing_key_version: latestVersion });
  await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: true, recovered_key_version: versions.join(',') });
  log.info('xchat', `[ensureKeys] cached ${versions.length} key version(s) for user ${userId}`);
  return { allKeys, latestVersion, latest: allKeys[latestVersion] };
}

export const unlockKeys = async (req: Request, res: Response) => {
  try {
    const { id: integrationId } = req.params;
    const { auth: authType } = req.query;
    const force = req.query.force === '1';

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Integration not found or invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    try {
      const result = await ensureKeys(userId, resolved.client, { force });
      if (!result) {
        res.json({ success: true, unlocked: false, reason: "PIN not set or no public keys on server" });
        return;
      }
      res.json({ success: true, unlocked: true, signing_key_version: result.latestVersion, key_count: Object.keys(result.allKeys).length });
    } catch (err: any) {
      log.warn('xchat', `[unlock] Juicebox recovery failed: ${err.message}`);
      await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: false, error: err.message });
      res.json({ success: true, unlocked: false, reason: err.message });
    }
  } catch (error: any) {
    log.error('xchat', `unlockKeys failed:`, error.message || error);
    const status = error.status || 500;
    const message = error.message?.includes('<!DOCTYPE') ? `${status} Error` : error.message || 'Unknown error';
    res.status(status).json({ error: message });
  }
};

/** Unlock a single key version with a specific PIN. */
export const unlockKeyVersion = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, version } = req.params;
    const { auth: authType } = req.query;
    const { pin } = req.body;

    if (!pin || !/^[0-9]{4}$/.test(pin)) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Integration not found or invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const xchat = await userXChatStorage.load(userId) ?? { id: userId };

    // Fetch the specific version's juicebox_config
    const pkData = await resolved.client.users.getUsersPublicKey(userId, {
      'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
    }) as any;
    const entries = Array.isArray(pkData?.data) ? pkData.data : pkData?.data ? [pkData.data] : [];
    const entry = entries.find((e: any) => String(e.public_key_version) === version);
    if (!entry) {
      res.status(404).json({ error: `Key version ${version} not found on server` });
      return;
    }

    const jbConfig = entry.juicebox_config ?? entry.token_map;
    if (!jbConfig?.key_store_token_map_json) {
      res.status(400).json({ error: `No juicebox_config for version ${version}` });
      return;
    }

    try {
      const configJson = buildJuiceboxConfigJson(jbConfig);
      const secret = await recover(pin, configJson, userId, juiceboxLogger);
      const decryptKeyB64 = Buffer.from(secret.slice(0, 32)).toString('base64');
      const signingKeyB64 = secret.length >= 64 ? Buffer.from(secret.slice(32, 64)).toString('base64') : decryptKeyB64;
      const kp: KeyPair = { signingKeyB64, decryptKeyB64 };

      const allKeys = { ...(xchat.private_keys || {}), [version]: kp };
      const pins = { ...(xchat.pins || {}), [version]: pin };
      await userXChatStorage.save({ ...xchat, private_keys: allKeys, pins });

      log.info('xchat', `[unlockVersion] recovered key version ${version} for user ${userId}`);
      await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: true, recovered_key_version: version });
      res.json({ success: true, unlocked: true, version });
    } catch (err: any) {
      log.warn('xchat', `[unlockVersion] recovery failed for version ${version}: ${err.message}`);
      await keyRecoveryHistory.append({ userId, timestamp: new Date().toISOString(), success: false, error: `version ${version}: ${err.message}` });
      res.json({ success: true, unlocked: false, reason: err.message });
    }
  } catch (error: any) {
    log.error('xchat', `unlockKeyVersion failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
  }
};

/** Change PIN for a specific key version on Juicebox. */
export const changePinForVersion = async (req: Request, res: Response) => {
  try {
    const { id: integrationId, version } = req.params;
    const { auth: authType } = req.query;
    const { newPin } = req.body;

    if (!newPin || !/^[0-9]{4}$/.test(newPin)) {
      res.status(400).json({ error: "New PIN must be exactly 4 digits" });
      return;
    }

    const resolved = await resolveAuth(integrationId, authType as string);
    if (!resolved) { res.status(400).json({ error: "Integration not found or invalid auth" }); return; }

    const userId = await resolveUserId(integrationId);
    if (!userId) { res.status(400).json({ error: "Could not resolve user ID" }); return; }

    const xchat = await userXChatStorage.load(userId);
    if (!xchat) { res.status(400).json({ error: "No xchat entry" }); return; }

    const kp = xchat.private_keys?.[version];
    if (!kp) {
      res.status(400).json({ error: `Key version ${version} not unlocked. Unlock it first.` });
      return;
    }

    // Fetch fresh juicebox_config for this version
    const pkData = await resolved.client.users.getUsersPublicKey(userId, {
      'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
    }) as any;
    const entries = Array.isArray(pkData?.data) ? pkData.data : pkData?.data ? [pkData.data] : [];
    const entry = entries.find((e: any) => String(e.public_key_version) === version);
    const jbConfig = entry?.juicebox_config ?? entry?.token_map;
    if (!jbConfig?.key_store_token_map_json) {
      res.status(400).json({ error: `No juicebox_config for version ${version}` });
      return;
    }

    const secret = Buffer.concat([Buffer.from(kp.decryptKeyB64, 'base64'), Buffer.from(kp.signingKeyB64, 'base64')]);
    const configJson = buildJuiceboxConfigJson(jbConfig);
    await juiceboxRegister(newPin, secret, configJson, userId, juiceboxLogger);

    // Save new PIN for this version
    const pins = { ...(xchat.pins || {}), [version]: newPin };
    await userXChatStorage.save({ ...xchat, pins });

    log.info('xchat', `[changePinVersion] PIN changed for version ${version}, user ${userId}`);
    res.json({ success: true, version });
  } catch (error: any) {
    log.error('xchat', `changePinForVersion failed:`, error.message || error);
    res.status(error.status || 500).json({ error: error.message || "Unknown error" });
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

    const userKeys = await ensureKeys(userId, resolved.client);
    if (!userKeys) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    // Always resolve the latest conversation key from API
    const latest = await resolveLatestConversationKey(resolved.client, apiConvId, canonicalId, userId, userKeys);
    const convKeyEntry = latest
      ? { encrypted_conversation_key: latest.encryptedConvKey, key_version: latest.keyVersion }
      : await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptReaction(
      JSON.stringify(userKeys.latest), convKeyEntry.encrypted_conversation_key,
      message_sequence_id, emoji, !!remove,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', userKeys.latestVersion,
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

    const userKeys = await ensureKeys(userId, resolved.client);
    if (!userKeys) { res.status(400).json({ error: "Keys not available" }); return; }

    const canonicalId = toCanonicalConvId(conversationId);
    const apiConvId = toApiConvId(conversationId);
    // Always resolve the latest conversation key from API
    const latest = await resolveLatestConversationKey(resolved.client, apiConvId, canonicalId, userId, userKeys);
    const convKeyEntry = latest
      ? { encrypted_conversation_key: latest.encryptedConvKey, key_version: latest.keyVersion }
      : await conversationKeyStorage.load(canonicalId);
    if (!convKeyEntry?.encrypted_conversation_key) { res.status(400).json({ error: "No conversation key" }); return; }

    const messageId = crypto.randomUUID();
    const payload = await encryptEdit(
      JSON.stringify(userKeys.latest), convKeyEntry.encrypted_conversation_key,
      message_sequence_id, text,
      messageId, userId, canonicalId,
      convKeyEntry.key_version || '1', userKeys.latestVersion,
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
        'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key'] as any,
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
        const configJson = buildJuiceboxConfigJson(juiceboxConfig);
        await juiceboxRegister(xchat.pin, secret, configJson, userId, juiceboxLogger);
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
          'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
        }) as any;
        const freshConfig = pkData.data?.find((k: any) => k.public_key_version === version)?.juicebox_config;
        if (freshConfig) {
          log.info('xchat', `[register] enrolling keys in Juicebox (fresh config) for user ${userId}`);
          const configJson = buildJuiceboxConfigJson(freshConfig);
          await juiceboxRegister(xchat.pin, secret, configJson, userId, juiceboxLogger);
          log.info('xchat', `[register] Juicebox enrollment successful`);
        }
      } catch (fetchErr: any) {
        log.warn('xchat', `[register] could not fetch juicebox_config for enrollment: ${fetchErr.message}`);
      }
    }

    // Step 4: Store keys locally
    const newKeyPair: KeyPair = {
      signingKeyB64: signingScalar.toString('base64'),
      decryptKeyB64: decryptScalar.toString('base64'),
    };
    const existingKeys = xchat.private_keys || {};
    const updatedKeys = { ...existingKeys, [version]: newKeyPair };

    await userXChatStorage.save({
      ...xchat,
      private_keys: updatedKeys,
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
      'public_key.fields': ['public_key_version', 'public_key', 'signing_public_key', 'juicebox_config'] as any,
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
    const userKeys = await ensureKeys(userId, resolved.client);
    if (!userKeys) {
      res.status(400).json({ error: "Keys not available. Set PIN and unlock first." });
      return;
    }
    const secret = Buffer.concat([
      Buffer.from(userKeys.latest.decryptKeyB64, 'base64'),
      Buffer.from(userKeys.latest.signingKeyB64, 'base64'),
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
