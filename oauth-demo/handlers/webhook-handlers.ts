import { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { log } from "../logger";
import { CredentialsStorage, UserXChatStorage, ConversationKeyStorage } from "../storage";
import { EventBus } from "../event-bus";
import { webhookDelayConfig } from "./webhook-config";
import { __dirname } from "../esm-utils";
import { unwrapConversationKey, secretboxDecrypt, verifyMessageSignature } from "../xchat/chat-crypto";
import { decode } from "../xchat/thrift-codec";
import { MessageEventSchema } from "../xchat/thrift-models";
import { decodeMessageEntryHolder, extractContentsFromMessageEvent } from "../xchat/chat-thrift";

const webhookLogDir = path.join(__dirname(import.meta.url), "../data/webhooks");
const credentialsStorage = new CredentialsStorage();
const userXChatStorage = new UserXChatStorage();
const conversationKeyStorage = new ConversationKeyStorage();

export const webhookEventBus = new EventBus();

async function ensureWebhookDir() {
    await fs.mkdir(webhookLogDir, { recursive: true });
}

export const listWebhookEvents = async (req: Request, res: Response) => {
    try {
        await ensureWebhookDir();
        const files = await fs.readdir(webhookLogDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                const tsA = parseInt(a.replace('.json', '').split('-').pop()!);
                const tsB = parseInt(b.replace('.json', '').split('-').pop()!);
                return tsB - tsA;
            })
            .slice(0, 100);
        const events = await Promise.all(jsonFiles.map(async f => {
            const data = JSON.parse(await fs.readFile(path.join(webhookLogDir, f), 'utf-8'));
            const bodyHash = f.split('-')[1];
            const duplicates = files.filter(df => df.startsWith(`webhook-${bodyHash}-`) && df !== f).map(df => {
                const ts = parseInt(df.replace(`webhook-${bodyHash}-`, '').replace('.json', ''));
                return new Date(ts).toISOString();
            });
            return { filename: f, ...data, duplicateDates: duplicates };
        }));
        res.json(events);
    } catch (error: any) {
        log.error('webhook', 'listWebhookEvents failed:', error.message);
        res.status(500).json({ error: error.message });
    }
};

export const handleWebhook = async (req: Request, res: Response) => {
    const { appId } = req.params;

    if (req.method === 'GET') {
        const crc_token = req.query.crc_token;
        if (!crc_token) {
            res.status(400).send("Missing crc_token");
            return;
        }

        log.debug('webhook', `CRC request received for app ${appId}`, { ip: req.ip });

        const creds = await credentialsStorage.load(appId);
        if (!creds?.consumer_secret) {
            log.error('webhook', `No consumer_secret found for app ${appId}`);
            res.status(500).json({ error: "Consumer secret not found" });
            return;
        }

        const hmac = crypto.createHmac("sha256", creds.consumer_secret);
        hmac.update(crc_token as string);
        const response_token = "sha256=" + hmac.digest("base64");
        log.info('webhook', `CRC response ready for app ${appId}, sending now`);

        if (webhookDelayConfig.crcDelayMs > 0) {
            log.info('webhook', `CRC delay: ${webhookDelayConfig.crcDelayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, webhookDelayConfig.crcDelayMs));
        }

        res.json({ response_token });
        return;
    }

    // POST webhook — verify signature
    const signature = req.headers['x-twitter-webhooks-signature'] as string;
    if (!signature) {
        log.warn('webhook', `Missing signature header for app ${appId}`);
        res.status(401).json({ error: 'Missing signature' });
        return;
    }

    const creds = await credentialsStorage.load(appId);
    if (!creds?.consumer_secret) {
        log.error('webhook', `No consumer_secret found for app ${appId}`);
        res.status(500).json({ error: 'Consumer secret not found' });
        return;
    }

    const rawBody = (req as any).rawBody as Buffer;
    const expected = 'sha256=' + crypto.createHmac('sha256', creds.consumer_secret).update(rawBody).digest('base64');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        log.warn('webhook', `Invalid signature for app ${appId}`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    try {
        await ensureWebhookDir();

        const timestamp = new Date().toISOString();
        const bodyHash = crypto.createHash("sha256").update(JSON.stringify(req.body)).digest("hex").slice(0, 12);
        const filename = `webhook-${bodyHash}-${Date.now()}.json`;
        const filePath = path.join(webhookLogDir, filename);

        const webhookData = {
            timestamp,
            headers: req.headers,
            body: req.body,
            query: req.query,
            method: req.method,
            url: req.url
        };

        const existing = (await fs.readdir(webhookLogDir)).filter(f => f.startsWith(`webhook-${bodyHash}-`) && f !== filename);
        if (existing.length > 0) {
            const dates = existing.map(f => {
                const ts = parseInt(f.replace(`webhook-${bodyHash}-`, "").replace(".json", ""));
                return new Date(ts).toISOString();
            });
            log.info('webhook', `Duplicate webhook (hash=${bodyHash}), previously received at: ${dates.join(", ")}`);
        }

        log.info('webhook', `Event received from ${req.ip}`, webhookData.body);

        // Attempt to decrypt xchat events
        let decrypted: any = undefined;
        try {
          decrypted = await decryptXChatWebhook(webhookData.body);
        } catch (e: any) {
          log.debug('webhook', `xchat decrypt skipped: ${e.message}`);
        }

        await fs.writeFile(filePath, JSON.stringify({ ...webhookData, decrypted }, null, 2));

        webhookEventBus.broadcast({ filename, ...webhookData, decrypted, duplicateDates: existing.map(f => {
            const ts = parseInt(f.replace(`webhook-${bodyHash}-`, "").replace(".json", ""));
            return new Date(ts).toISOString();
        })});

        if (webhookDelayConfig.webhookDelayMs > 0) {
            log.info('webhook', `Webhook reply delay: ${webhookDelayConfig.webhookDelayMs}ms`);
            await new Promise(r => setTimeout(r, webhookDelayConfig.webhookDelayMs));
        }

        // Slowly stream JSON response to test Twitter's timeout behavior
        const responseJson = JSON.stringify({ status: "received" });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(responseJson) });
        for (const ch of responseJson) {
            res.write(ch);
            // await new Promise(r => setTimeout(r, 500));
        }
        res.end();
    } catch (error: any) {
        log.error('webhook', 'Handler error:', error.error || error.message || error);
        const status = error.status || 500;
        res.status(status).json({ error: error.error || error.message || "Unknown error" });
    }
};


/**
 * Attempt to decrypt an xchat webhook event.
 * Returns decrypted content or undefined if not an xchat event or decryption fails.
 */
async function decryptXChatWebhook(body: any): Promise<any> {
  const payload = body?.data?.payload;
  const eventType = body?.data?.event_type;
  if (!payload || !eventType?.startsWith('chat.')) return undefined;

  const userId = body.data.filter?.user_id;
  if (!userId) throw new Error('no user_id in filter');

  const xchat = await userXChatStorage.load(userId);

  // Collect all available private keys indexed by version
  const allKeysByVersion: Record<string, string> = {};
  if (xchat?.private_keys) {
    for (const [ver, kp] of Object.entries(xchat.private_keys)) allKeysByVersion[ver] = kp.decryptKeyB64;
  } else if (xchat?.private_key) {
    const keys = JSON.parse(xchat.private_key);
    allKeysByVersion['legacy'] = keys.decryptKeyB64;
  }
  const allDecryptKeys = Object.values(allKeysByVersion);
  if (allDecryptKeys.length === 0) throw new Error('no private key for user');

  const conversationId = payload.conversation_id;
  let convKey: Buffer | null = null;

  // Step 1: Try to extract conversation key from key_change_event
  if (payload.conversation_key_change_event) {
    log.debug('webhook', `[xchat-decrypt] extracting conversation key from key_change_event`);
    try {
      const { encKey, publicKeyVersion } = getOurParticipantEntry(payload.conversation_key_change_event, userId);
      if (encKey) {
        // Try the hinted version first, then brute-force
        const keysToTry = publicKeyVersion && allKeysByVersion[publicKeyVersion]
          ? [allKeysByVersion[publicKeyVersion], ...allDecryptKeys.filter(k => k !== allKeysByVersion[publicKeyVersion])]
          : allDecryptKeys;
        for (const dk of keysToTry) {
          try {
            convKey = unwrapConversationKey(encKey, dk);
            if (convKey) break;
          } catch {}
        }
        if (convKey && conversationId) {
          await conversationKeyStorage.save({
            id: conversationId,
            encrypted_conversation_key: encKey,
            key_version: payload.conversation_key_version || '',
            cached_at: new Date().toISOString(),
          });
          log.info('webhook', `[xchat-decrypt] conversation key cached for ${conversationId} (version=${payload.conversation_key_version})`);
        }
      }
    } catch (e: any) {
      log.warn('webhook', `[xchat-decrypt] key extraction failed: ${e.message}`);
    }
  }

  // Step 2: If no key from event, try cached (try all private keys)
  if (!convKey && conversationId) {
    const cached = await conversationKeyStorage.load(conversationId);
    if (cached?.encrypted_conversation_key) {
      for (const dk of allDecryptKeys) {
        try {
          convKey = unwrapConversationKey(cached.encrypted_conversation_key, dk);
          log.debug('webhook', `[xchat-decrypt] using cached conversation key for ${conversationId}`);
          break;
        } catch {}
      }
      if (!convKey) log.warn('webhook', `[xchat-decrypt] cached key unwrap failed with all ${allDecryptKeys.length} key(s)`);
    }
  }

  if (!convKey) throw new Error('no conversation key available');

  // Step 3: Decrypt the encoded_event
  if (!payload.encoded_event) throw new Error('no encoded_event in payload');

  log.debug('webhook', `[xchat-decrypt] decrypting message from ${payload.sender_id}`);
  const eventBuf = Buffer.from(payload.encoded_event, 'base64');

  // Verify message signature
  const fullEvent = decode(eventBuf, MessageEventSchema);
  const sigValid = verifyMessageSignature(fullEvent);
  if (sigValid === false) {
    log.warn('webhook', `[xchat-decrypt] ⚠️ INVALID signature on message ${payload.id} from ${payload.sender_id}`);
  } else if (sigValid === true) {
    log.debug('webhook', `[xchat-decrypt] ✓ signature verified for message ${payload.id}`);
  }

  const contents = extractContentsFromMessageEvent(eventBuf);
  if (!contents) throw new Error('could not extract contents from MessageEvent');

  // Decrypt with secretbox
  const plaintext = await secretboxDecrypt(contents, convKey);

  // Decode thrift MessageEntryHolder
  const decoded = decodeMessageEntryHolder(plaintext);

  if (decoded?.reaction) {
    log.info('webhook', `[xchat-decrypt] reaction ${decoded.reaction.action}: ${decoded.reaction.emoji} on ${decoded.reaction.message_sequence_id}`);
    return {
      sender_id: payload.sender_id,
      conversation_id: conversationId,
      reaction: decoded.reaction,
      decrypted_at: new Date().toISOString(),
    };
  }

  if (decoded?.edit) {
    log.info('webhook', `[xchat-decrypt] edit on ${decoded.edit.message_sequence_id}: "${decoded.edit.updated_text?.slice(0, 50)}"`);
    return {
      sender_id: payload.sender_id,
      conversation_id: conversationId,
      edit: decoded.edit,
      decrypted_at: new Date().toISOString(),
    };
  }

  const text = decoded?.message?.text;
  const attachments = decoded?.message?.attachments;

  log.info('webhook', `[xchat-decrypt] decrypted message: "${text?.slice(0, 50)}${text && text.length > 50 ? '...' : ''}"${attachments?.length ? ` + ${attachments.length} attachment(s)` : ''}`);

  return {
    sender_id: payload.sender_id,
    conversation_id: conversationId,
    text,
    entities: decoded?.message?.entities,
    attachments: attachments?.map(a => ({
      media_hash_key: a.media_hash_key,
      type: a.type === 1 ? 'image' : a.type === 2 ? 'gif' : a.type === 3 ? 'video' : a.type === 4 ? 'audio' : a.type === 5 ? 'file' : a.type === 6 ? 'svg' : a.url ? 'url' : `unknown(${a.type})`,
      filename: a.filename,
      url: a.url,
      display_url: a.display_url,
      width: a.width,
      height: a.height,
      filesize_bytes: a.filesize_bytes,
    })),
    reply_to: decoded?.message?.reply_to,
    decrypted_at: new Date().toISOString(),
  };
}

/** Extract our participant entry (encrypted_conversation_key + public_key_version) from a key_change_event */
function getOurParticipantEntry(keyChangeEventB64: string, userId: string): { encKey: string; publicKeyVersion: string } {
  const buf = Buffer.from(keyChangeEventB64, 'base64');
  const event = decode(buf, MessageEventSchema);
  const participants = event.detail?.conversationKeyChangeEvent?.conversation_participant_keys || [];
  const ours = participants.find((pk: any) => pk.user_id === userId);
  return { encKey: ours?.encrypted_conversation_key || '', publicKeyVersion: ours?.public_key_version || '' };
}


