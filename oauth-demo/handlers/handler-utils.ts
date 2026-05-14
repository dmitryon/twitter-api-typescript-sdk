import { Request, Response } from "express";
import { Client, auth } from "twitter-api-sdk";
import { IntegrationStorage, CredentialsStorage, AccessTokenStorage } from "../storage";
import { oauthFromIntegration } from "../oauth-utils";
import { FileCache } from "../file-cache";
import path from "path";
import { apiLogger } from "../api-logger";

const integrationStorage = new IntegrationStorage();
const credentialsStorage = new CredentialsStorage();
const accessTokenStorage = new AccessTokenStorage();

export const mediaCache = new FileCache(
  path.join(__dirname, "../data/media-cache"),
  30 * 24 * 60 * 60 * 1000 // 30 days
);

export interface ResolvedAuth {
  client: Client;
  integration: any;
  authClient: any;
}

export async function resolveAuth(integrationId: string, authType: string): Promise<ResolvedAuth | null> {
  const integration = await integrationStorage.load(integrationId);
  if (!integration) return null;

  const authClient = await oauthFromIntegration(
    authType as 'oauth1' | 'oauth2',
    integration,
    credentialsStorage,
    accessTokenStorage,
    integrationStorage
  );
  if (!authClient) return null;

  const client = new Client(authClient, { logger: apiLogger });
  return { client, integration, authClient };
}

export function sseResponse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') (res as any).flush();
  };

  return sendEvent;
}

export async function appBearerClient(appId: string): Promise<Client> {
  const creds = await credentialsStorage.load(appId);
  if (!creds?.consumer_key || !creds?.consumer_secret) {
    throw new Error("Consumer key/secret required for app-level auth");
  }
  const appAuth = new auth.OAuth2AppHandler(creds.consumer_key, creds.consumer_secret, { logger: apiLogger });
  return new Client(appAuth, { logger: apiLogger });
}

export { integrationStorage, credentialsStorage, accessTokenStorage };
