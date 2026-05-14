import { Request, Response } from "express";
import { resolveAuth, mediaCache, sseResponse, integrationStorage } from "./handler-utils";
import { log } from "../logger";
import crypto from "crypto";

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
    log.error('xchat', `getXChatConversations failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
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

    // GET /2/chat/conversations/{id} is not in the OpenAPI spec and therefore
    // not generated on the Client. Calling directly via auth client.
    const params: Record<string, string> = {};
    if (pagination_token) params.pagination_token = pagination_token as string;

    const url = `https://api.x.com/2/chat/conversations/${conversationId}?${new URLSearchParams(params)}`;
    const headers = await resolved.authClient.getAuthHeader({ url, method: 'GET' });
    const response = await fetch(url, { headers: headers as any });
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }

    log.debug('xchat', `Fetched messages for conversation ${conversationId}`);
    res.json(data);
  } catch (error: any) {
    log.error('xchat', `getXChatMessages failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const sendXChatMessage = async (req: Request, res: Response) => {
  try {
    const { id, conversationId } = req.params;
    const { auth: authType } = req.query;
    const { text, media_hash_key } = req.body;

    const resolved = await resolveAuth(id, authType as string);
    if (!resolved) {
      res.status(400).json({ error: "Integration not found or invalid auth" });
      return;
    }

    // Load xchat settings to get PIN and cached private key.
    // The real encryption flow (when chat-xdk becomes available in TS) is:
    //   1. If private_key not cached: use PIN + public_keys to retrieve from Juicebox via XDK
    //   2. Use private_key to decrypt the conversation key
    //   3. Use conversation key to encrypt the message via XDK
    //   4. Serialize as Thrift MessageCreateEvent, base64-encode → encoded_message_create_event
    // For now: best-effort base64-encoded JSON as a stub to exercise the API endpoint.
    const integration = await integrationStorage.load(id);
    const xchat = integration?.xchat;

    if (!xchat?.pin) {
      res.status(400).json({ error: "X Chat PIN not set. Please configure your PIN first." });
      return;
    }

    // TODO: when chat-xdk TypeScript bindings are available, replace this stub with:
    //   const privateKey = xchat.private_key ?? await xdk.retrievePrivateKey(xchat.pin, publicKeys);
    //   const conversationKey = xchat.conversation_keys?.[conversationId]
    //     ?? await xdk.decryptConversationKey(privateKey, conversationId);
    //   const encoded_message_create_event = await xdk.encryptMessage(conversationKey, { text, media_hash_key });
    const messagePayload: any = { text, pin_used: !!xchat.pin, private_key_cached: !!xchat.private_key };
    if (media_hash_key) messagePayload.media = { media_hash_key };
    const encoded_message_create_event = Buffer.from(JSON.stringify(messagePayload)).toString('base64');
    const message_id = crypto.randomUUID();

    log.info('xchat', `Sending message to ${conversationId} — PIN: set, private_key: ${xchat.private_key ? 'cached' : 'not cached'} (stub encryption)`);

    const response = await resolved.client.chat.sendChatMessage(conversationId, {
      encoded_message_create_event,
      message_id,
    });

    log.info('xchat', `Sent message to conversation ${conversationId} (message_id=${message_id})`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `sendXChatMessage failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
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

    const response = await resolved.client.users.getUsersPublicKey(userId);
    log.debug('xchat', `Fetched public keys for user ${userId}`);
    res.json(response);
  } catch (error: any) {
    log.error('xchat', `getUserPublicKeys failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
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
    log.error('xchat', `Media proxy failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const updateXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { pin, private_key, public_key_version, conversation_key } = req.body;

    const integration = await integrationStorage.load(id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    if (pin !== undefined) {
      if (!/^[0-9]{4}$/.test(pin)) {
        res.status(400).json({ error: "PIN must be exactly 4 digits" });
        return;
      }
      integration.xchat = { ...integration.xchat, pin };
    }

    if (private_key !== undefined) {
      integration.xchat = { ...integration.xchat!, private_key, public_key_version };
    }

    // Store a single conversation key: { conversation_id, key }
    if (conversation_key) {
      const { conversation_id, key } = conversation_key;
      integration.xchat = {
        ...integration.xchat!,
        conversation_keys: {
          ...(integration.xchat?.conversation_keys || {}),
          [conversation_id]: key,
        },
      };
    }

    await integrationStorage.save(integration);
    log.info('xchat', `Updated xchat settings for integration ${id}`);
    // Never return the private key or PIN in the response
    const { private_key: _pk, pin: _pin, ...safeXchat } = integration.xchat || {} as any;
    res.json({ success: true, xchat: { ...safeXchat, has_pin: !!integration.xchat?.pin, has_private_key: !!integration.xchat?.private_key } });
  } catch (error: any) {
    log.error('xchat', `updateXChatSettings failed:`, error.message || error);
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};

export const getXChatSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const integration = await integrationStorage.load(id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    const xchat = integration.xchat;
    if (!xchat) {
      res.json({ xchat: null });
      return;
    }
    // Never expose PIN or private key — only report presence
    const { private_key: _pk, pin: _pin, conversation_keys, public_key_version } = xchat;
    res.json({
      xchat: {
        has_pin: !!_pin,
        has_private_key: !!_pk,
        public_key_version,
        conversation_key_count: Object.keys(conversation_keys || {}).length,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown error" });
  }
};
