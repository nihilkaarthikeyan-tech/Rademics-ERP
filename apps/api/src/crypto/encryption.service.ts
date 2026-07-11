import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Field-level encryption at rest for salary + PII (Spec §10) — not merely
 * full-disk encryption. AES-256-GCM (authenticated). The 32-byte key is derived
 * from FIELD_ENCRYPTION_KEY so key material of any length is accepted.
 *
 * Ciphertext format: `v1.<iv>.<authTag>.<data>` (each part base64).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const material = config.getOrThrow<string>('FIELD_ENCRYPTION_KEY');
    this.key = createHash('sha256').update(material).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid ciphertext format');
    }
    const iv = Buffer.from(parts[1]!, 'base64');
    const tag = Buffer.from(parts[2]!, 'base64');
    const data = Buffer.from(parts[3]!, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  encryptNullable(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    return this.encrypt(plain);
  }

  decryptNullable(payload: string | null | undefined): string | null {
    if (!payload) return null;
    return this.decrypt(payload);
  }
}
