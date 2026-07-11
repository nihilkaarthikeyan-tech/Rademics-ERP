import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

function makeService(key = 'test-key-material'): EncryptionService {
  const config = { getOrThrow: () => key } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe('EncryptionService (Spec §10 field-level encryption)', () => {
  it('round-trips a value', () => {
    const svc = makeService();
    const ct = svc.encrypt('50000');
    expect(ct).not.toContain('50000');
    expect(svc.decrypt(ct)).toBe('50000');
  });

  it('produces different ciphertext each time (random IV)', () => {
    const svc = makeService();
    expect(svc.encrypt('secret')).not.toBe(svc.encrypt('secret'));
  });

  it('fails to decrypt if the auth tag/data is tampered', () => {
    const svc = makeService();
    const ct = svc.encrypt('sensitive');
    const parts = ct.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from('xxxx').toString('base64')}`;
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const a = makeService('key-a');
    const b = makeService('key-b');
    expect(() => b.decrypt(a.encrypt('x'))).toThrow();
  });

  it('handles nullable helpers', () => {
    const svc = makeService();
    expect(svc.encryptNullable(null)).toBeNull();
    expect(svc.encryptNullable('')).toBeNull();
    expect(svc.decryptNullable(null)).toBeNull();
    const ct = svc.encryptNullable('bank-123');
    expect(svc.decryptNullable(ct)).toBe('bank-123');
  });
});
