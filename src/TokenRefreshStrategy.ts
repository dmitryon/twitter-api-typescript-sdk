import fs from "fs/promises";
import path from "path";
import type { Token } from "./OAuth2User";

/**
 * Strategy for coordinating token refresh.
 * Override for distributed locking (e.g. DynamoDB, Redis, file system).
 *
 * Example DynamoDB implementation:
 *
 *   class DynamoDBTokenRefreshStrategy extends TokenRefreshStrategy {
 *     constructor(
 *       private tokenId: string,
 *       private dynamodb: DynamoDB,
 *       private tableName: string
 *     ) { super(); }
 *
 *     async execute(currentToken: Token, doRefresh: () => Promise<Token>): Promise<Token> {
 *       const lockKey = { pk: `lock#${this.tokenId}` };
 *       const ttl = Math.floor(Date.now() / 1000) + 30;
 *
 *       try {
 *         await this.dynamodb.put({
 *           TableName: this.tableName, Item: { ...lockKey, ttl },
 *           ConditionExpression: "attribute_not_exists(pk)"
 *         });
 *       } catch (e) {
 *         if (e.name === "ConditionalCheckFailedException") {
 *           return await this.waitForFreshToken();
 *         }
 *         throw e;
 *       }
 *       try {
 *         const stored = await this.readToken();
 *         if (stored?.expires_at && stored.expires_at > Date.now() + 1000) return stored;
 *         return await doRefresh();
 *       } finally {
 *         await this.dynamodb.delete({ TableName: this.tableName, Key: lockKey });
 *       }
 *     }
 *
 *     private async readToken(): Promise<Token | undefined> {
 *       const result = await this.dynamodb.get({
 *         TableName: this.tableName, Key: { pk: `token#${this.tokenId}` }
 *       });
 *       return result.Item?.token as Token | undefined;
 *     }
 *
 *     private async waitForFreshToken(): Promise<Token> {
 *       for (let i = 0; i < 10; i++) {
 *         await new Promise(r => setTimeout(r, 500));
 *         const stored = await this.readToken();
 *         if (stored?.expires_at && stored.expires_at > Date.now() + 1000) return stored;
 *       }
 *       throw new Error("Timed out waiting for token refresh");
 *     }
 *   }
 */
export abstract class TokenRefreshStrategy {
  abstract execute(currentToken: Token, doRefresh: () => Promise<Token>): Promise<Token>;
}

/**
 * Default in-memory strategy that coalesces concurrent refreshes into one call.
 * Suitable for single-process deployments.
 *
 * This is the default strategy used by OAuth2User when no strategy is specified:
 *
 *   const oauth2 = new auth.OAuth2User({
 *     client_id: "...",
 *     callback: "...",
 *     scopes: ["tweet.read", "offline.access"]
 *   });
 */
export class InMemoryTokenRefreshStrategy extends TokenRefreshStrategy {
  #refreshPromise?: Promise<Token>;

  async execute(_currentToken: Token, doRefresh: () => Promise<Token>): Promise<Token> {
    if (!this.#refreshPromise) {
      this.#refreshPromise = doRefresh().finally(() => { this.#refreshPromise = undefined; });
    }
    return this.#refreshPromise;
  }
}

export interface FileLockTokenRefreshStrategyOptions {
  /** Directory to store lock files */
  lockDir: string;
  /** Unique identifier for this token (used as lock filename) */
  tokenId: string;
  /** Callback to read the current token from storage */
  readToken: () => Promise<Token | undefined>;
  /** Lock TTL in milliseconds. Default: 30000 */
  lockTtlMs?: number;
  /** Poll interval in milliseconds when waiting for another process. Default: 200 */
  pollIntervalMs?: number;
  /** Max wait time in milliseconds when another process holds the lock. Default: 10000 */
  maxWaitMs?: number;
}

/**
 * File-system based lock strategy for coordinating token refresh across processes.
 * Uses exclusive file creation (wx flag) as an atomic lock primitive.
 * Suitable for multi-process deployments on a single machine.
 *
 * Usage:
 *
 *   const oauth2 = new auth.OAuth2User({
 *     client_id: "...",
 *     callback: "...",
 *     scopes: ["tweet.read", "offline.access"],
 *     refreshStrategy: new auth.FileLockTokenRefreshStrategy({
 *       lockDir: "/tmp/twitter-locks",
 *       tokenId: "my-app-my-user",
 *       readToken: async () => {
 *         const data = JSON.parse(await fs.readFile("/path/to/token.json", "utf-8"));
 *         return data.token;
 *       }
 *     })
 *   });
 */
export class FileLockTokenRefreshStrategy extends TokenRefreshStrategy {
  #options: Required<FileLockTokenRefreshStrategyOptions>;

  constructor(options: FileLockTokenRefreshStrategyOptions) {
    super();
    this.#options = {
      lockTtlMs: 30000,
      pollIntervalMs: 200,
      maxWaitMs: 10000,
      ...options
    };
  }

  get #lockPath(): string {
    return path.join(this.#options.lockDir, `${this.#options.tokenId}.lock`);
  }

  async execute(currentToken: Token, doRefresh: () => Promise<Token>): Promise<Token> {
    await fs.mkdir(this.#options.lockDir, { recursive: true });

    const acquired = await this.#tryAcquire();
    if (!acquired) {
      return this.#waitForFreshToken(currentToken);
    }

    try {
      // Re-read token — another process may have refreshed it just before we acquired the lock
      const stored = await this.#options.readToken();
      if (stored?.expires_at && stored.expires_at > Date.now() + 1000) {
        return stored;
      }
      return await doRefresh();
    } finally {
      await this.#release();
    }
  }

  async #tryAcquire(): Promise<boolean> {
    try {
      await fs.writeFile(this.#lockPath, String(Date.now() + this.#options.lockTtlMs), { flag: "wx" });
      return true;
    } catch (e: any) {
      if (e.code === "EEXIST") {
        // Check if the lock is stale
        try {
          const content = await fs.readFile(this.#lockPath, "utf-8");
          if (Number(content) < Date.now()) {
            await fs.unlink(this.#lockPath);
            return this.#tryAcquire();
          }
        } catch {}
        return false;
      }
      throw e;
    }
  }

  async #release(): Promise<void> {
    try { await fs.unlink(this.#lockPath); } catch {}
  }

  async #waitForFreshToken(currentToken: Token): Promise<Token> {
    const deadline = Date.now() + this.#options.maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, this.#options.pollIntervalMs));
      const stored = await this.#options.readToken();
      if (stored?.expires_at && stored.expires_at > Date.now() + 1000) {
        return stored;
      }
      // Lock disappeared but token still stale — try to acquire ourselves
      if (await this.#tryAcquire()) {
        return currentToken; // will be detected as expired again, triggering doRefresh via getAuthHeader
      }
    }
    throw new Error("Timed out waiting for token refresh");
  }
}
