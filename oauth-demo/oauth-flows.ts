import { auth, types } from "twitter-api-sdk";
import type { ParsedQs } from "qs";
import { TwitterApplicationCredentials } from "./types";

type AccessTokenResponse = auth.AccessTokenResponse;
type OAuth2Scopes = auth.OAuth2Scopes;
type Token = auth.Token;
type AuthState = types.AuthState;
type QueryString = ParsedQs;

const OAUTH2_SCOPES: OAuth2Scopes[] = ["tweet.read", "tweet.write", "users.read", "follows.read", "dm.read", "dm.write", "media.write", "offline.access",
    // like.read is required due to a recent bug with user subscriptions
    "like.read"];

export interface CallbackParams {}

export abstract class OAuthFlow {
  abstract startFlow(credentials: TwitterApplicationCredentials, state: string): Promise<{ auth_url: string; authState: AuthState }>;
  abstract extractCallbackParams(query: QueryString): CallbackParams;
  abstract handleCallback(credentials: TwitterApplicationCredentials, authState: AuthState, callbackParams: CallbackParams): Promise<{ tokens: AccessTokenResponse | Token; authClient: auth.OAuth1User | auth.OAuth2User }>;
}

interface OAuth1CallbackParams extends CallbackParams { oauth_verifier: string; state: string }

function isOAuth1CallbackParams(params: CallbackParams): params is OAuth1CallbackParams {
  return "oauth_verifier" in params;
}

export class OAuth1Flow extends OAuthFlow {
  async startFlow(credentials: TwitterApplicationCredentials, state: string) {
    if (!credentials.consumer_key) {
      throw new Error("OAuth1 credentials not found");
    }
    
    const callbackWithState = `${credentials.oauthCallbackUrl}?state=${state}`;
    const oauth1 = new auth.OAuth1User({
      consumer_key: credentials.consumer_key,
      consumer_secret: credentials.consumer_secret!,
      callback: callbackWithState
    });
    
    const { auth_url, oauth_callback_confirmed } = await oauth1.requestToken();
    if (oauth_callback_confirmed.toString().toLowerCase() !== 'true') {
        throw new Error("OAuth callback not confirmed");
    }
    return {
      auth_url: auth_url + '&force_login=true',
      authState: oauth1.getAuthState()
    };
  }
  
  extractCallbackParams(query: QueryString): OAuth1CallbackParams {
    const { oauth_verifier, state } = query;
    if (typeof oauth_verifier !== "string" || typeof state !== "string") {
      throw new Error("Missing required OAuth1 callback parameters");
    }
    return { oauth_verifier, state };
  }
  
  async handleCallback(credentials: TwitterApplicationCredentials, authState: AuthState, callbackParams: CallbackParams) {
    if (!isOAuth1CallbackParams(callbackParams)) {
      throw new Error("Invalid OAuth1 callback");
    }
    const { oauth_verifier, state } = callbackParams;
    
    const callbackWithState = `${credentials.oauthCallbackUrl}?state=${state}`;
    const oauth1 = new auth.OAuth1User({
      consumer_key: credentials.consumer_key!,
      consumer_secret: credentials.consumer_secret!,
      callback: callbackWithState
    });
    
    oauth1.setAuthState(authState);
    const tokens = await oauth1.requestAccessToken(oauth_verifier);
    
    const authenticatedOAuth1 = new auth.OAuth1User({
      consumer_key: credentials.consumer_key!,
      consumer_secret: credentials.consumer_secret!,
      access_token: tokens.oauth_token,
      access_token_secret: tokens.oauth_token_secret
    });
    return { tokens, authClient: authenticatedOAuth1 };
  }
}

interface OAuth2CallbackParams extends CallbackParams { code: string; state: string }

function isOAuth2CallbackParams(params: CallbackParams): params is OAuth2CallbackParams {
  return "code" in params;
}

export class OAuth2Flow extends OAuthFlow {
  async startFlow(credentials: TwitterApplicationCredentials, state: string) {
    if (!credentials.client_id) {
      throw new Error("OAuth2 credentials not found");
    }
    
    const oauth2 = new auth.OAuth2User({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      callback: credentials.oauthCallbackUrl,
      scopes: OAUTH2_SCOPES
    });
    
    const auth_url = oauth2.generateAuthURL({
      state,
      code_challenge_method: "s256"
    });
    
    return {
      auth_url,
      authState: oauth2.getAuthState()
    };
  }
  
  extractCallbackParams(query: QueryString): OAuth2CallbackParams {
    const { code, state } = query;
    if (typeof code !== "string" || typeof state !== "string") {
      throw new Error("Missing required OAuth2 callback parameters");
    }
    return { code, state };
  }
  
  async handleCallback(credentials: TwitterApplicationCredentials, authState: AuthState, callbackParams: CallbackParams) {
    if (!isOAuth2CallbackParams(callbackParams)) {
      throw new Error("Invalid OAuth2 callback");
    }
    const { code } = callbackParams;
    
    const oauth2 = new auth.OAuth2User({
      client_id: credentials.client_id!,
      client_secret: credentials.client_secret,
      callback: credentials.oauthCallbackUrl,
      scopes: OAUTH2_SCOPES
    });
    
    oauth2.setAuthState(authState);
    const { token } = await oauth2.requestAccessToken(code);
    
    return { tokens: token, authClient: oauth2 };
  }

  async revokeTokens(authClient: auth.OAuth2User) {
    await authClient.revokeAccessToken();
  }
}
