import { Request, Response } from "express";
import crypto from "crypto";
import { Client, auth } from "twitter-api-sdk";
import { AuthSession, AccessTokenEntry } from "../types";
import { IntegrationStorage, CredentialsStorage, AuthSessionStorage, AccessTokenStorage, TokenHistoryStorage } from "../storage";
import { OAuth1Flow, OAuth2Flow } from "../oauth-flows";
import { log } from "../logger";
import { oauthFromIntegration } from "../oauth-utils";
import { apiLogger } from "../api-logger";

const oauthFlows = {
  oauth1: new OAuth1Flow(),
  oauth2: new OAuth2Flow()
};

const integrationStorage = new IntegrationStorage();
const credentialsStorage = new CredentialsStorage();
const authSessionStorage = new AuthSessionStorage();
const accessTokenStorage = new AccessTokenStorage();
const tokenHistory = new TokenHistoryStorage();

export const oauthLogin = async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    const integration = await integrationStorage.load(id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const credentials = await credentialsStorage.load(integration.appId);
    if (!credentials) {
      res.status(404).json({ error: "Credentials not found" });
      return;
    }
    
    const flow = oauthFlows[type as keyof typeof oauthFlows];
    if (!flow) {
      res.status(400).json({ error: "Invalid OAuth type" });
      return;
    }
    
    const sessionId = crypto.randomUUID();
    const state = Buffer.from(sessionId).toString('base64url');
    const { auth_url, authState } = await flow.startFlow(credentials, state);
    log.info('oauth', `Started ${type} flow for integration ${id}`);
    
    const session: AuthSession = {
      id: sessionId,
      integrationId: integration.id,
      authType: type,
      authState,
      createdAt: new Date().toISOString()
    };
    
    await authSessionStorage.save(session);
    res.json({ auth_url });
  } catch (error: any) {
    log.error('oauth', `Login ${req.params.type} failed for integration ${req.params.id}:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const oauthCallback = async (req: Request, res: Response) => {
  try {
    const { state } = req.query;
    
    if (!state) {
      res.status(400).json({ error: "Invalid callback" });
      return;
    }
    
    const sessionId = Buffer.from(state as string, 'base64url').toString();
    const session = await authSessionStorage.load(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    
    const integration = await integrationStorage.load(session.integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    
    const credentials = await credentialsStorage.load(integration.appId);
    if (!credentials) {
      res.status(404).json({ error: "Credentials not found" });
      return;
    }
    
    const authType = session.authType as 'oauth1' | 'oauth2';
    const flow = oauthFlows[authType];
    const callbackParams = flow.extractCallbackParams(req.query);
    const { tokens, authClient } = await flow.handleCallback(credentials, session.authState, callbackParams);
    
    const client = new Client(authClient, { logger: apiLogger });
    const userResponse = await client.users.getUsersMe({
      "user.fields": ["id", "username", "name", "profile_image_url"]
    });
    
    const user = {
      id: userResponse.data!.id,
      username: userResponse.data!.username!,
      name: userResponse.data!.name!,
      pictureUrl: userResponse.data!.profile_image_url
    };

    const accessTokenId = authType === 'oauth1'
      ? AccessTokenStorage.makeId(integration.appId, authType, `${user.id}-${integration.id}`)
      : AccessTokenStorage.makeId(integration.appId, authType, user.id);
    const tokenData = authType === 'oauth1'
      ? { access_token: (tokens as auth.AccessTokenResponse).oauth_token, access_token_secret: (tokens as auth.AccessTokenResponse).oauth_token_secret }
      : { access_token: (tokens as auth.Token).access_token, refresh_token: (tokens as auth.Token).refresh_token, expires_at: (tokens as auth.Token).expires_at };

    const entry: AccessTokenEntry = { id: accessTokenId, appId: integration.appId, authType, user, tokens: tokenData };
    const existingEntry = await accessTokenStorage.load(accessTokenId);
    await accessTokenStorage.save(entry);

    await tokenHistory.append({
      accessTokenId,
      authType,
      integrationIds: [integration.id],
      oldTokens: existingEntry?.tokens || {},
      newTokens: tokenData,
      changedAt: new Date().toISOString()
    });

    integration[authType] = { accessTokenId };
    await integrationStorage.save(integration);

    // For oauth2, link all other integrations for the same app+user that don't
    // yet have an oauth2 reference — the shared token file is already updated
    if (authType === 'oauth2') {
      const allIntegrations = await integrationStorage.list();
      for (const other of allIntegrations) {
        if (other.id === integration.id || other.appId !== integration.appId) continue;
        if (other.oauth2?.accessTokenId) continue;
        // Check if this integration belongs to the same user via oauth1
        if (!other.oauth1?.accessTokenId) continue;
        const otherEntry = await accessTokenStorage.load(other.oauth1.accessTokenId);
        if (otherEntry?.user?.id === user.id) {
          other.oauth2 = { accessTokenId };
          await integrationStorage.save(other);
          log.info('oauth', `Linked OAuth2 token to integration ${other.id}`);
        }
      }
    }

    await authSessionStorage.delete(session.id);
    log.info('oauth', `Callback ${authType} success for integration ${session.integrationId}: user @${user.username} (${user.id})`);
    res.json({ success: true, tokens, user });
  } catch (error: any) {
    log.error('oauth', `Callback failed:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const refreshOAuth2Token = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const integration = await integrationStorage.load(id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    if (!integration.oauth2?.accessTokenId) {
      res.status(400).json({ error: "No OAuth2 token available" });
      return;
    }

    const tokenEntry = await accessTokenStorage.load(integration.oauth2.accessTokenId);
    if (!tokenEntry?.tokens?.refresh_token) {
      res.status(400).json({ error: "No refresh token available" });
      return;
    }
    
    const authClient = await oauthFromIntegration('oauth2', integration, credentialsStorage, accessTokenStorage, integrationStorage);
    if (!authClient) {
      res.status(400).json({ error: "Failed to create OAuth2 client" });
      return;
    }
    
    const oldTokens = { ...tokenEntry.tokens };
    const { token } = await (authClient as auth.OAuth2User).refreshAccessToken();
    
    const newTokens = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: token.expires_at };
    const allIntegrations = await integrationStorage.list();
    const integrationIds = allIntegrations.filter(i => i.oauth2?.accessTokenId === integration.oauth2!.accessTokenId).map(i => i.id);
    await tokenHistory.append({ accessTokenId: integration.oauth2.accessTokenId, authType: 'oauth2', integrationIds, oldTokens, newTokens, changedAt: new Date().toISOString() });

    tokenEntry.tokens = newTokens;
    await accessTokenStorage.save(tokenEntry);

    log.info('oauth', `Refreshed OAuth2 token for integration ${id}: ${oldTokens.access_token?.slice(0, 20)}... -> ${token.access_token?.slice(0, 20)}...`);
    res.json({ success: true, tokens: token });
  } catch (error: any) {
    log.error('oauth', `Refresh OAuth2 failed for integration ${req.params.id}:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};

export const initAuthStorage = async () => {
  await authSessionStorage.init();
  await accessTokenStorage.init();
};

export const revokeOAuth1Tokens = async (req: Request, res: Response) => {
  const { id } = req.params;
  log.info('oauth', `Revoke OAuth1 requested for integration ${id}, redirecting to X.com`);
  res.json({ redirect_url: 'https://x.com/settings/connected_apps' });
};

export const revokeOAuth2Tokens = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const integration = await integrationStorage.load(id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    const authClient = await oauthFromIntegration('oauth2', integration, credentialsStorage, accessTokenStorage, integrationStorage);
    if (!authClient) {
      res.status(400).json({ error: "No OAuth2 tokens to revoke" });
      return;
    }

    const flow = oauthFlows.oauth2;
    await flow.revokeTokens(authClient as auth.OAuth2User);

    if (integration.oauth2?.accessTokenId) {
      await accessTokenStorage.delete(integration.oauth2.accessTokenId);
    }
    delete integration.oauth2;
    await integrationStorage.save(integration);
    log.info('oauth', `Revoked OAuth2 tokens for integration ${id}`);
    res.json({ success: true });
  } catch (error: any) {
    log.error('oauth', `Revoke OAuth2 failed for integration ${req.params.id}:`, error.error || error.message || error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || "Unknown error" });
  }
};
