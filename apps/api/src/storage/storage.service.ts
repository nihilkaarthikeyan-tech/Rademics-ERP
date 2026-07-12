import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';

/**
 * Object-storage access (Spec §5.6, §12). Uploads/downloads go DIRECTLY to storage
 * via presigned URLs — files never stream through the app server. The only
 * server-side read is the async virus scan (see ScanService).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = new URL(this.config.getOrThrow<string>('S3_ENDPOINT'));
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.client = new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, this.config.get<string>('S3_REGION', 'us-east-1'));
        this.logger.log(`Created object-storage bucket "${this.bucket}"`);
      }
    } catch (err) {
      // Don't crash the app if storage is briefly unavailable at boot; log loudly.
      this.logger.error(`Object storage not reachable at boot: ${(err as Error).message}`);
    }
  }

  /** Presigned PUT so the browser uploads directly to storage (§5.6). */
  presignedUpload(key: string, expirySeconds: number): Promise<string> {
    return this.client.presignedPutObject(this.bucket, key, expirySeconds);
  }

  /** Presigned GET so the browser downloads directly from storage (§5.6). */
  presignedDownload(key: string, expirySeconds: number, downloadName?: string): Promise<string> {
    const headers = downloadName
      ? { 'response-content-disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"` }
      : undefined;
    return this.client.presignedGetObject(this.bucket, key, expirySeconds, headers);
  }

  /** Fetch an object as a stream — used only by the scan worker (§5.6). */
  getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.bucket, key);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const s = await this.client.statObject(this.bucket, key);
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err) {
      this.logger.warn(`Failed to remove object ${key}: ${(err as Error).message}`);
    }
  }
}
