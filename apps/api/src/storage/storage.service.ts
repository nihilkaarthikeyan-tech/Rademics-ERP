import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';

/** Types safe to render in a browser tab. SVG is left out: it can carry script. */
const INLINE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function inlineType(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return INLINE_TYPES[ext] ?? null;
}

/**
 * Object-storage access (Spec §5.6, §12). Uploads/downloads go DIRECTLY to storage
 * via presigned URLs — files never stream through the app server. The only
 * server-side read is the async virus scan (see ScanService).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  /** Signs the URLs handed to browsers — must carry the PUBLIC host. Never dialled. */
  private readonly publicClient: MinioClient;
  /**
   * Every call the API itself makes (stat, scan read, remove, bucket check).
   * In prod this is the docker-network address, not the public vhost: the
   * public one sits behind Cloudflare, which at times rewrote the signed HEAD
   * from stat() into a GET — the signature then failed (403) and finalize
   * reported a file that was sitting in the bucket as "not found".
   */
  private readonly client: MinioClient;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    const publicUrl = this.config.getOrThrow<string>('S3_ENDPOINT');
    this.publicClient = this.makeClient(publicUrl);
    this.client = this.makeClient(this.config.get<string>('S3_INTERNAL_ENDPOINT') || publicUrl);
  }

  private makeClient(url: string): MinioClient {
    const endpoint = new URL(url);
    return new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      // Set explicitly so presigning never makes a region-lookup call.
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
    return this.publicClient.presignedPutObject(this.bucket, key, expirySeconds);
  }

  /**
   * Presigned GET so the browser downloads directly from storage (§5.6).
   * `inline` renders in the browser (an <img> src, or a tab that previews a
   * PDF/image) instead of forcing a Save dialog — the default stays
   * `attachment` so every existing caller (task files, portal) is unchanged.
   */
  presignedDownload(
    key: string,
    expirySeconds: number,
    downloadName?: string,
    inline = false,
  ): Promise<string> {
    // The stored Content-Type is whatever the uploader's PUT claimed, so never
    // trust it: an "a.pdf" stored as text/html, opened inline, would run that
    // page on the storage host. The type is decided here from the name, and
    // only images and PDFs may render; everything else is a plain download.
    const safeInlineType = inlineType(downloadName ?? key);
    const asInline = inline && safeInlineType !== null;
    const headers: Record<string, string> = {
      'response-content-type': asInline ? safeInlineType : 'application/octet-stream',
    };
    if (downloadName || !asInline) {
      const name = (downloadName ?? key.split('/').pop() ?? 'file').replace(/"/g, '');
      headers['response-content-disposition'] = `${asInline ? 'inline' : 'attachment'}; filename="${name}"`;
    }
    return this.publicClient.presignedGetObject(this.bucket, key, expirySeconds, headers);
  }

  /** Fetch an object as a stream — used only by the scan worker (§5.6). */
  getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.bucket, key);
  }

  /** null only when the object genuinely isn't there; any other failure throws. */
  async stat(key: string): Promise<{ size: number; etag: string } | null> {
    try {
      const s = await this.client.statObject(this.bucket, key);
      return { size: s.size, etag: s.etag };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NotFound' || code === 'NoSuchKey') return null;
      // Swallowing this is what once disguised a 403 as "upload not found".
      this.logger.error(`Storage stat failed for ${key}: ${code ?? ''} ${(err as Error).message}`);
      throw err;
    }
  }

  /** Server-side copy inside the bucket — no download/upload round trip. */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    await this.client.copyObject(this.bucket, destKey, `/${this.bucket}/${sourceKey}`);
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err) {
      this.logger.warn(`Failed to remove object ${key}: ${(err as Error).message}`);
    }
  }
}
