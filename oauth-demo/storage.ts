import fs from "fs/promises";
import path from "path";
import { Integration, TwitterApplicationCredentials, AuthSession, AccessTokenEntry } from "./types";
import { ApiCallLogger, ApiCallLogEntry } from "twitter-api-sdk";
import { log as consoleLog } from "./logger";

class BaseStorage<T> {
  protected dataDir: string;
  
  constructor(subDir: string) {
    this.dataDir = path.join(__dirname, "data", subDir);
  }

  protected extractId(item: T): string { return (item as any).id; }
  
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }
  
  async save(item: T) {
    const filePath = path.join(this.dataDir, `${this.extractId(item)}.json`);
    await fs.writeFile(filePath, JSON.stringify(item, null, 2));
  }
  
  async load(id: string): Promise<T | null> {
    try {
      const filePath = path.join(this.dataDir, `${id}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  
  async delete(id: string): Promise<boolean> {
    try {
      const filePath = path.join(this.dataDir, `${id}.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  async list(): Promise<T[]> {
    try {
      const files = await fs.readdir(this.dataDir);
      const items = await Promise.all(
        files.filter(f => f.endsWith(".json")).map(async f => {
          const data = await fs.readFile(path.join(this.dataDir, f), "utf-8");
          return JSON.parse(data);
        })
      );
      return items;
    } catch {
      return [];
    }
  }
}

export class IntegrationStorage extends BaseStorage<Integration> {
  constructor() { super("integrations"); }
}

export class CredentialsStorage extends BaseStorage<TwitterApplicationCredentials> {
  constructor() { super("credentials"); }
  protected extractId(c: TwitterApplicationCredentials) { return c.appId; }
}

export class AuthSessionStorage extends BaseStorage<AuthSession> {
  constructor() { super("sessions"); }
}

export class AccessTokenStorage extends BaseStorage<AccessTokenEntry> {
  constructor() { super("access-tokens"); }
  static makeId(appId: string, authType: string, userId: string): string { return `${appId}-${authType}-${userId}`; }
}

export interface TokenChangeEntry {
  accessTokenId: string;
  authType: string;
  integrationIds: string[];
  oldTokens: Record<string, any>;
  newTokens: Record<string, any>;
  changedAt: string;
}

export class XApiCallLogger extends BaseStorage<ApiCallLogEntry> implements ApiCallLogger {
  private fileLogsEnabled: boolean;

  constructor() {
    super("x-api-requests");
    this.fileLogsEnabled = process.env.X_API_FILE_LOG !== "false";
  }

  async log(entry: ApiCallLogEntry) {
    const tag = `x-api ${entry.method}`;
    const summary = `${entry.endpoint} → ${entry.status} (${entry.duration_ms}ms)`;

    if (entry.status >= 400) {
      consoleLog.error(tag, summary, entry.response_body || "");
    } else {
      consoleLog.debug(tag, summary);
    }

    if (!this.fileLogsEnabled) return;
    await this.save(entry);
  }
}

export class TokenHistoryStorage extends BaseStorage<TokenChangeEntry> {
  constructor() {
    super("token-history");
  }

  protected extractId(e: TokenChangeEntry) {
    return `${e.accessTokenId}-${Date.now()}`;
  }

  async append(entry: TokenChangeEntry) {
    await this.save(entry);
  }
}