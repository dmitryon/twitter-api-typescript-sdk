// Copyright 2021 Twitter, Inc.
// SPDX-License-Identifier: Apache-2.0

import { AuthClient, AuthState, AuthHeader } from "./types";
import { basicAuthHeader } from "./utils";
import { rest, RequestOptions } from "./request";

interface TokenResponse {
  access_token: string;
  token_type: string;
}

/**
 * Twitter OAuth2 App-Only Authentication Handler
 * Uses client credentials flow to get app-only bearer token
 */
export class OAuth2AppHandler implements AuthClient {
  private consumer_key: string;
  private consumer_secret: string;
  private _bearer_token?: string;
  private request_options?: Partial<RequestOptions>;

  constructor(consumer_key: string, consumer_secret: string, request_options?: Partial<RequestOptions>) {
    this.consumer_key = consumer_key;
    this.consumer_secret = consumer_secret;
    this.request_options = request_options;
  }

  private async getBearerToken(): Promise<string> {
    if (this._bearer_token) {
      return this._bearer_token;
    }

    const response = await rest<TokenResponse>({
      ...this.request_options,
      endpoint: "/oauth2/token",
      method: "POST",
      base_url: "https://api.x.com",
      headers: {
        ...this.request_options?.headers,
        "Authorization": basicAuthHeader(this.consumer_key, this.consumer_secret),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      params: { grant_type: "client_credentials" }
    });

    if (response.token_type !== "bearer") {
      throw new Error(`Expected token_type to equal "bearer", but got ${response.token_type} instead`);
    }

    this._bearer_token = response.access_token;
    return this._bearer_token;
  }

  async getAuthHeader(): Promise<AuthHeader> {
    const token = await this.getBearerToken();
    return {
      Authorization: `Bearer ${token}`
    };
  }

  getAuthState(): AuthState {
    return {};
  }

  setAuthState(state: AuthState): void {
    // No intermediate state for app-only auth
  }
}