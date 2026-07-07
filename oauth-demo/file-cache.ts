import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { log } from "./logger";

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export class FileCache {
  private cacheDir: string;
  private ttl: number;
  private initialized = false;

  constructor(cacheDir: string, ttl: number = 30 * 24 * 60 * 60 * 1000) {
    this.cacheDir = cacheDir;
    this.ttl = ttl;
  }

  private async ensureDir() {
    if (!this.initialized) {
      try {
        await fs.mkdir(this.cacheDir, { recursive: true });
        this.initialized = true;
      } catch (error) {
        log.error('cache', 'Failed to create cache directory:', (error as Error).message);
      }
    }
  }

  private getHash(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex');
  }

  private getCacheMetaPath(key: string): string {
    return path.join(this.cacheDir, `${this.getHash(key)}.meta`);
  }

  private getCacheFilePath(hash: string, contentType?: string): string {
    // For legacy files with extensions, check if they exist; new files use no extension
    const ext = contentType ? (CONTENT_TYPE_TO_EXT[contentType] || '') : '';
    return path.join(this.cacheDir, ext ? `${hash}${ext}` : hash);
  }

  /** Resolve the actual file path, checking both with and without extension. */
  private async resolveFilePath(hash: string, contentType?: string): Promise<string | null> {
    // Try with extension first (legacy), then without
    if (contentType) {
      const withExt = path.join(this.cacheDir, `${hash}${CONTENT_TYPE_TO_EXT[contentType] || ''}`);
      try { await fs.stat(withExt); return withExt; } catch {}
    }
    const noExt = path.join(this.cacheDir, hash);
    try { await fs.stat(noExt); return noExt; } catch {}
    return null;
  }

  async get(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.ensureDir();
    try {
      const metaData = await fs.readFile(this.getCacheMetaPath(key), 'utf-8');
      const meta = JSON.parse(metaData);
      if (Date.now() - meta.timestamp >= this.ttl) return null;

      const filePath = await this.resolveFilePath(this.getHash(key), meta.contentType);
      if (!filePath) return null;
      const buffer = await fs.readFile(filePath);
      return { buffer, contentType: meta.contentType };
    } catch {
      return null;
    }
  }

  async getMeta(key: string): Promise<{ filePath: string; contentType: string; size: number } | null> {
    await this.ensureDir();
    try {
      const metaData = await fs.readFile(this.getCacheMetaPath(key), 'utf-8');
      const meta = JSON.parse(metaData);
      if (Date.now() - meta.timestamp >= this.ttl) return null;
      const filePath = await this.resolveFilePath(this.getHash(key), meta.contentType);
      if (!filePath) return null;
      const stat = await fs.stat(filePath);
      return { filePath, contentType: meta.contentType, size: stat.size };
    } catch {
      return null;
    }
  }

  async set(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.ensureDir();
    try {
      const hash = this.getHash(key);
      const filename = path.basename(new URL(key).pathname) || 'unknown';
      await Promise.all([
        fs.writeFile(this.getCacheFilePath(hash, contentType), buffer),
        fs.writeFile(this.getCacheMetaPath(key), JSON.stringify({
          contentType,
          timestamp: Date.now(),
          filename
        }))
      ]);
    } catch (error) {
      log.error('cache', 'Failed to cache file:', (error as Error).message);
    }
  }

  /** Get the file path where a cache entry would be written (for streaming writes). */
  async getWritePath(key: string, contentType: string): Promise<string> {
    await this.ensureDir();
    return this.getCacheFilePath(this.getHash(key), contentType);
  }

  /** Write only the metadata (call after streaming the file to getWritePath). */
  async setMeta(key: string, contentType: string): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.getCacheMetaPath(key), JSON.stringify({
      contentType,
      timestamp: Date.now(),
      filename: 'stream'
    }));
  }
}