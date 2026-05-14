import { auth } from "twitter-api-sdk";
import { Integration } from "./types";
import { CredentialsStorage, AccessTokenStorage, IntegrationStorage, TokenHistoryStorage } from "./storage";
import { log } from "./logger";
import { apiLogger } from "./api-logger";

const OAUTH2_SCOPES = ["tweet.read", "tweet.write", "users.read", "follows.read", "dm.read", "dm.write", "media.write", "offline.access"];

const tokenHistory = new TokenHistoryStorage();

async function findIntegrationsByToken(accessTokenId: string, authType: 'oauth1' | 'oauth2', integrationStorage: IntegrationStorage): Promise<string[]> {
  const all = await integrationStorage.list();
  return all.filter(i => i[authType]?.accessTokenId === accessTokenId).map(i => i.id);
}

export async function oauthFromIntegration(
  authType: 'oauth1' | 'oauth2', 
  integration: Integration,
  credentialsStorage: CredentialsStorage,
  accessTokenStorage: AccessTokenStorage,
  integrationStorage?: IntegrationStorage
): Promise<auth.OAuth1User | auth.OAuth2User | null> {
  const credentials = await credentialsStorage.load(integration.appId);
  if (!credentials) return null;

  const accessTokenId = authType === 'oauth1' ? integration.oauth1?.accessTokenId : integration.oauth2?.accessTokenId;
  if (!accessTokenId) return null;

  const tokenEntry = await accessTokenStorage.load(accessTokenId);
  if (!tokenEntry) return null;
  
  if (authType === 'oauth2') {
    const oauth2 = new auth.OAuth2User({
      client_id: credentials.client_id!,
      client_secret: credentials.client_secret,
      callback: credentials.oauthCallbackUrl,
      scopes: OAUTH2_SCOPES as any,
      request_options: { logger: apiLogger },
      onTokenRefresh: async (token) => {
        const oldTokens = { ...tokenEntry.tokens };
        const newTokens = {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: token.expires_at
        };
        log.info('oauth', `Auto-refreshed OAuth2 token for ${accessTokenId}: ${oldTokens.access_token?.slice(0, 20)}... -> ${token.access_token?.slice(0, 20)}...`);
        await tokenHistory.append({
          accessTokenId,
          authType: 'oauth2',
          integrationIds: integrationStorage ? await findIntegrationsByToken(accessTokenId, 'oauth2', integrationStorage) : [integration.id],
          oldTokens,
          newTokens,
          changedAt: new Date().toISOString()
        });
        tokenEntry.tokens = newTokens;
        await accessTokenStorage.save(tokenEntry);
      }
    });
    oauth2.token = tokenEntry.tokens as any;
    return oauth2;
  } else {
    return new auth.OAuth1User({
      consumer_key: credentials.consumer_key!,
      consumer_secret: credentials.consumer_secret!,
      access_token: tokenEntry.tokens.access_token,
      access_token_secret: tokenEntry.tokens.access_token_secret,
      request_options: { logger: apiLogger },
    });
  }
}
