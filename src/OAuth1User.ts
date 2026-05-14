// Copyright 2021 Twitter, Inc.
// SPDX-License-Identifier: Apache-2.0

import crypto from "crypto";
import { buildQueryString } from "./utils";
import { AuthClient, AuthHeader, OAuth1AuthState } from "./types";
import { RequestOptions, request } from "./request";

export interface OAuth1UserOptions {
  /** Consumer Key (API Key) */
  consumer_key: string;
  /** Consumer Secret (API Secret) */
  consumer_secret: string;
  /** Callback URL */
  callback?: string;
  /** Access Token */
  access_token?: string;
  /** Access Token Secret */
  access_token_secret?: string;
  /** Base URL for Twitter API */
  base_url?: string;
  /** Overwrite request options for all endpoints */
  request_options?: Partial<RequestOptions>;
}

interface RequestTokenResponse {
  oauth_token: string;
  oauth_token_secret: string;
  oauth_callback_confirmed: string;
}

export interface AccessTokenResponse {
  oauth_token: string;
  oauth_token_secret: string;
  user_id: string;
  screen_name: string;
}

/**
 * Twitter OAuth 1.0a Authentication Client
 */
export class OAuth1User implements AuthClient {
  #options: OAuth1UserOptions;
  #request_token?: string;
  #request_token_secret?: string;

  constructor(options: OAuth1UserOptions) {
    this.#options = options;
  }

  /**
   * Generate OAuth 1.0a signature
   */
  #generateSignature(
    method: string,
    url: string,
    params: Record<string, string>
  ): string {
    const { consumer_secret, access_token_secret } = this.#options;
    
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join("&");

    const baseString = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(sortedParams)
    ].join("&");

    const signingKey = [
      encodeURIComponent(consumer_secret),
      encodeURIComponent(access_token_secret || this.#request_token_secret || "")
    ].join("&");



    return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  }

  /**
   * Generate OAuth 1.0a authorization header
   */
  #generateAuthHeader(
    method: string,
    url: string,
    additionalParams: Record<string, string> = {}
  ): string {
    const { consumer_key, access_token } = this.#options;
    
    // Parse URL to separate base URL from query parameters
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: consumer_key,
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: "1.0",
      ...(access_token && { oauth_token: access_token }),
      ...additionalParams
    };

    // Include query parameters in signature
    const allParams = { ...oauthParams };
    for (const [key, value] of urlObj.searchParams.entries()) {
      allParams[key] = value;
    }

    const signature = this.#generateSignature(method, baseUrl, allParams);
    oauthParams.oauth_signature = signature;

    const authHeader = Object.keys(oauthParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
      .join(", ");

    return `OAuth ${authHeader}`;
  }

  /**
   * Request a request token
   */
  async requestToken(): Promise<RequestTokenResponse & { auth_url: string }> {
    const { callback, base_url = "https://api.x.com" } = this.#options;
    const url = `${base_url}/oauth/request_token`;
    
    const authHeader = this.#generateAuthHeader("POST", url, {
      ...(callback && { oauth_callback: callback })
    });

    const response = await request({
      ...this.#options.request_options,
      endpoint: "/oauth/request_token",
      method: "POST",
      headers: {
        ...this.#options.request_options?.headers,
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      base_url
    });
    
    const responseText = await response.text();
    const params = new URLSearchParams(responseText);
    this.#request_token = params.get("oauth_token")!;
    this.#request_token_secret = params.get("oauth_token_secret")!;

    const auth_url = `${base_url}/oauth/authorize?oauth_token=${this.#request_token}`;
    
    return {
      oauth_token: this.#request_token,
      oauth_token_secret: this.#request_token_secret,
      oauth_callback_confirmed: params.get("oauth_callback_confirmed")!,
      auth_url
    };
  }

  /**
   * Request access token
   */
  async requestAccessToken(oauth_verifier: string): Promise<AccessTokenResponse> {
    if (!this.#request_token) {
      throw new Error("Request token required. Call requestToken() first.");
    }

    const { base_url = "https://api.x.com" } = this.#options;
    const url = `${base_url}/oauth/access_token`;
    const authHeader = this.#generateAuthHeader("POST", url, {
      oauth_token: this.#request_token,
      oauth_verifier
    });

    const response = await request({
      ...this.#options.request_options,
      endpoint: "/oauth/access_token",
      method: "POST",
      headers: {
        ...this.#options.request_options?.headers,
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      base_url
    });
    
    const responseText = await response.text();
    const params = new URLSearchParams(responseText);
    const accessToken: AccessTokenResponse = {
      oauth_token: params.get("oauth_token")!,
      oauth_token_secret: params.get("oauth_token_secret")!,
      user_id: params.get("user_id")!,
      screen_name: params.get("screen_name")!
    };

    this.#options.access_token = accessToken.oauth_token;
    this.#options.access_token_secret = accessToken.oauth_token_secret;

    return accessToken;
  }

  getAuthState(): OAuth1AuthState {
    return {
      request_token: this.#request_token,
      request_token_secret: this.#request_token_secret
    };
  }

  setAuthState(state: OAuth1AuthState): void {
    this.#request_token = state.request_token;
    this.#request_token_secret = state.request_token_secret;
  }

  async getAuthHeader(
    context?: { url?: string; method?: string; body?: string }
  ): Promise<AuthHeader> {
    if (!this.#options.access_token) {
      throw new Error("Access token required");
    }
    if (!context?.url || !context?.method) {
      throw new Error("OAuth 1.0a requires URL and method for signature generation");
    }

    const authHeader = this.#generateAuthHeader(context.method, context.url);

    return {
      Authorization: authHeader
    };
  }
}