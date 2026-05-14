import { AuthState } from "../src/types";

export interface TwitterApplicationCredentials {
  appId: string;
  name: string;
  oauthCallbackUrl: string;
  consumer_key?: string;
  consumer_secret?: string;
  client_id?: string;
  client_secret?: string;
}

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  pictureUrl?: string;
}

export interface AuthSession {
  id: string;
  integrationId: string;
  authType: string;
  authState: AuthState;
  createdAt: string;
}

export interface Integration {
  id: string;
  name: string;
  appId: string;
  oauth1?: {
    accessTokenId: string;
  };
  oauth2?: {
    accessTokenId: string;
  };
  xchat?: {
    /** 4-digit numeric PIN set by the user in the X app */
    pin: string;
    /** Cached private key retrieved from Juicebox using PIN + public keys */
    private_key?: string;
    /** Cached public key version, to detect when key has rotated */
    public_key_version?: string;
    /** Cached conversation keys: conversationId -> decrypted symmetric key */
    conversation_keys?: Record<string, string>;
  };
}

export interface AccessTokenEntry {
  id: string;
  appId: string;
  authType: 'oauth1' | 'oauth2';
  user: TwitterUser;
  tokens: Record<string, any>;
}