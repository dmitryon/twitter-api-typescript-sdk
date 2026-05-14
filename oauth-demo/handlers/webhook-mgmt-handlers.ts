import { Request, Response } from "express";
import { Client, auth } from "twitter-api-sdk";
import fs from "fs/promises";
import path from "path";
import { CredentialsStorage, IntegrationStorage, AccessTokenStorage } from "../storage";
import { oauthFromIntegration } from "../oauth-utils";
import { FileCache } from "../file-cache";
import { log } from "../logger";
import { apiLogger } from "../api-logger";

const credentialsStorage = new CredentialsStorage();
const integrationStorage = new IntegrationStorage();
const accessTokenStorage = new AccessTokenStorage();

const USER_CACHE_DIR = path.join(__dirname, "../data/user-cache");
const USER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const imageCache = new FileCache(
  path.join(__dirname, "../data/image-cache"),
  30 * 24 * 60 * 60 * 1000 // 30 days
);

async function ensureUserCacheDir() {
  await fs.mkdir(USER_CACHE_DIR, { recursive: true });
}

async function getCachedUser(id: string): Promise<any | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(USER_CACHE_DIR, `${id}.json`), "utf-8"));
    if (Date.now() - data.cachedAt < USER_CACHE_TTL) {
      const { cachedAt, ...user } = data;
      return user;
    }
  } catch {}
  return null;
}

async function cacheUser(id: string, user: any) {
  await fs.writeFile(path.join(USER_CACHE_DIR, `${id}.json`), JSON.stringify({ ...user, cachedAt: Date.now() }));
}

async function appClientFromCredentials(appId: string): Promise<Client> {
  const creds = await credentialsStorage.load(appId);
  if (!creds) throw new Error("Credentials not found");
  if (!creds.consumer_key || !creds.consumer_secret) {
    throw new Error("Consumer key/secret required for app-level auth");
  }
  const appAuth = new auth.OAuth2AppHandler(creds.consumer_key, creds.consumer_secret, { logger: apiLogger });
  return new Client(appAuth, { logger: apiLogger });
}

// Webhook CRUD

export const listWebhooks = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const webhooks = await client.webhooks.getWebhooks();
    log.debug('webhook-mgmt', `Listed webhooks for app ${req.params.appId}`);
    res.json(webhooks);
  } catch (error: any) {
    log.error('webhook-mgmt', `listWebhooks failed (${req.params.appId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const createWebhook = async (req: Request, res: Response) => {
  try {
    let { url } = req.body;
    const { appId } = req.params;
    const webhookPath = `/webhook/${appId}`;
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') {
      url = `${parsed.origin}${webhookPath}`;
    }
    log.debug('webhook-mgmt', `Creating webhook for app ${appId}: ${url}`);
    const client = await appClientFromCredentials(appId);
    const webhook = await client.webhooks.createWebhooks({ url });
    log.info('webhook-mgmt', `Created webhook: ${url}`, webhook);
    res.json(webhook);
  } catch (error: any) {
    log.error('webhook-mgmt', `createWebhook failed for URL ${req.body?.url}:`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const deleteWebhook = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const result = await client.webhooks.deleteWebhooks(req.params.webhookId);
    log.info('webhook-mgmt', `Deleted webhook ${req.params.webhookId}`);
    res.json(result);
  } catch (error: any) {
    log.error('webhook-mgmt', `deleteWebhook failed (${req.params.webhookId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const validateWebhook = async (req: Request, res: Response) => {
  try {
    log.info('webhook-mgmt', `Triggering CRC validation for webhook ${req.params.webhookId}...`);
    const startTime = Date.now();
    const client = await appClientFromCredentials(req.params.appId);
    const result = await client.webhooks.validateWebhooks(req.params.webhookId);
    log.info('webhook-mgmt', `CRC validation PUT returned after ${Date.now() - startTime}ms`, JSON.stringify(result, undefined, 2));
    res.json(result);
  } catch (error: any) {
    log.error('webhook-mgmt', `validateWebhook failed (${req.params.webhookId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

// Subscription management

export const getSubscriptionCount = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const count = await client.accountactivity.getAccountActivitySubscriptionCount();
    log.debug('subscription', `Count for app ${req.params.appId}:`, count);
    res.json(count);
  } catch (error: any) {
    log.error('subscription', `getSubscriptionCount failed (${req.params.appId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const listSubscriptions = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const subscriptions = await client.accountactivity.getAccountActivitySubscriptions(req.params.webhookId);
    log.debug('subscription', `Listed subscriptions for webhook ${req.params.webhookId}`);
    res.json(subscriptions);
  } catch (error: any) {
    log.error('subscription', `listSubscriptions failed (${req.params.webhookId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const createSubscription = async (req: Request, res: Response) => {
  try {
    const { integrationId, authType } = req.body;
    const integration = await integrationStorage.load(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const effectiveAuthType = authType || 'oauth1';
    log.debug('subscription', `Creating subscription: webhook=${req.params.webhookId}, integration=${integrationId}, authType=${effectiveAuthType}`);
    
    const authClient = await oauthFromIntegration(effectiveAuthType, integration, credentialsStorage, accessTokenStorage);
    if (!authClient) {
      res.status(400).json({ error: "No valid auth tokens for this integration" });
      return;
    }
    
    const accessTokenId = effectiveAuthType === 'oauth2'
      ? integration.oauth2?.accessTokenId
      : integration.oauth1?.accessTokenId;
    const tokenEntry = accessTokenId ? await accessTokenStorage.load(accessTokenId) : null;
    const tokenPreview = tokenEntry?.tokens?.access_token?.slice(0, 20) + '...';
    log.debug('subscription', `Using token: ${tokenPreview}`);
    
    const userClient = new Client(authClient, { logger: apiLogger });
    const result = await userClient.accountactivity.createAccountActivitySubscription(req.params.webhookId, {});
    log.info('subscription', `Created subscription on webhook ${req.params.webhookId} for integration ${integrationId}`);
    res.json(result);
  } catch (error: any) {
    log.error('subscription', 'createSubscription failed:', error.error || error.message || error);
    const status = error.status || 500;
    const message = error.error || error.message || 'Unknown error';
    res.status(status).json({ error: message });
  }
};

export const deleteSubscription = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const result = await client.accountactivity.deleteAccountActivitySubscription(req.params.webhookId, req.params.userId);
    log.info('subscription', `Deleted subscription for user ${req.params.userId} on webhook ${req.params.webhookId}`);
    res.json(result);
  } catch (error: any) {
    log.error('subscription', `deleteSubscription failed (user ${req.params.userId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const validateSubscription = async (req: Request, res: Response) => {
  try {
    const client = await appClientFromCredentials(req.params.appId);
    const result = await client.accountactivity.validateAccountActivitySubscription(req.params.webhookId);
    log.info('subscription', `Validated subscriptions on webhook ${req.params.webhookId}`);
    res.json(result);
  } catch (error: any) {
    log.error('subscription', `validateSubscription failed (${req.params.webhookId}):`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

// Public image proxy with file cache

export const proxyPublicImage = async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url) {
      res.status(400).json({ error: "URL parameter required" });
      return;
    }
    
    const cached = await imageCache.get(url as string);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.send(cached.buffer);
      return;
    }
    
    const response = await fetch(url as string);
    if (!response.ok) {
      res.status(response.status).json({ error: "Failed to fetch image" });
      return;
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    
    await imageCache.set(url as string, buffer, contentType);
    
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (error: any) {
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const lookupUsers = async (req: Request, res: Response) => {
  try {
    const ids = (req.query.ids as string || '').split(',').filter(Boolean);
    if (ids.length === 0) {
      res.json({ data: {} });
      return;
    }
    
    await ensureUserCacheDir();
    const result: Record<string, any> = {};
    const uncachedIds: string[] = [];
    
    for (const id of ids) {
      const cached = await getCachedUser(id);
      if (cached) {
        result[id] = cached;
      } else {
        uncachedIds.push(id);
      }
    }
    
    if (uncachedIds.length > 0) {
      const client = await appClientFromCredentials(req.params.appId);
      for (let i = 0; i < uncachedIds.length; i += 100) {
        const batch = uncachedIds.slice(i, i + 100);
        const response = await client.users.getUsersByIds({
          ids: batch,
          "user.fields": [
            "id", "name", "username", "created_at", "description",
            "entities", "location", "pinned_tweet_id", "profile_image_url",
            "protected", "public_metrics", "url", "verified", "withheld"
          ],
          expansions: ["pinned_tweet_id"]
        });
        for (const user of response.data || []) {
          await cacheUser(user.id, user);
          result[user.id] = user;
        }
      }
    }
    
    log.debug('user-lookup', `Looked up ${ids.length} users (${uncachedIds.length} fetched, ${ids.length - uncachedIds.length} cached)`);
    res.json({ data: result });
  } catch (error: any) {
    log.error('user-lookup', `lookupUsers failed:`, error.error || error.message || error);
    const status = error.status || 500; res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};
