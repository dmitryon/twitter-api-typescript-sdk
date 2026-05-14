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
    const ext = contentType ? (CONTENT_TYPE_TO_EXT[contentType] || '') : '';
    return path.join(this.cacheDir, `${hash}${ext}`);
  }

  async get(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.ensureDir();
    try {
      const metaData = await fs.readFile(this.getCacheMetaPath(key), 'utf-8');
      const meta = JSON.parse(metaData);
      if (Date.now() - meta.timestamp >= this.ttl) return null;

      const buffer = await fs.readFile(this.getCacheFilePath(this.getHash(key), meta.contentType));
      return { buffer, contentType: meta.contentType };
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
}