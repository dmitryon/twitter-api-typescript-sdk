// Copyright 2021 Twitter, Inc.
// SPDX-License-Identifier: Apache-2.0

import { AuthClient, AuthHeader, AuthState } from "./types";

export class OAuth2Bearer implements AuthClient {
  private bearer_token: string;

  constructor(bearer_token: string) {
    this.bearer_token = bearer_token;
  }

  async getAuthHeader(): Promise<AuthHeader> {
    return {
      Authorization: `Bearer ${this.bearer_token}`
    };
  }

  getAuthState(): AuthState {
    return {};
  }

  setAuthState(state: AuthState): void {
    // No intermediate state for bearer token
  }
}
