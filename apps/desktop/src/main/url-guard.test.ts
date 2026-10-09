import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl, originOf } from './url-guard';
import { resolveInside } from './local-server';

/**
 * Links and file paths that come from a page are never trusted (2026-10-09).
 * Windows will run whatever a URL scheme points at, and the packaged renderer
 * server sits on the employee's machine — so both only accept what they need.
 */
describe('isAllowedExternalUrl', () => {
  it('lets web and email links through', () => {
    expect(isAllowedExternalUrl('https://example.com/a', false)).toBe(true);
    expect(isAllowedExternalUrl('mailto:someone@example.com', false)).toBe(true);
  });

  it('allows plain http only in dev', () => {
    expect(isAllowedExternalUrl('http://localhost:3000', false)).toBe(false);
    expect(isAllowedExternalUrl('http://localhost:3000', true)).toBe(true);
  });

  it('drops schemes that can run things', () => {
    for (const bad of [
      'file:///C:/Windows/System32/calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedExternalUrl(bad, true)).toBe(false);
    }
  });
});

describe('originOf', () => {
  it('returns the origin, or null for junk', () => {
    expect(originOf('https://storage.52digit.com/bucket/f?x=1')).toBe('https://storage.52digit.com');
    expect(originOf('nope')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('resolveInside', () => {
  const root = resolve('/srv/renderer');

  it('serves files inside the renderer folder', () => {
    expect(resolveInside(root, '/index.html')).toBe(join(root, 'index.html'));
    expect(resolveInside(root, '/assets/app%20x.js')).toBe(join(root, 'assets', 'app x.js'));
  });

  it('refuses paths that climb out, however they are spelled', () => {
    expect(resolveInside(root, '/../secret.txt')).toBeNull();
    expect(resolveInside(root, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveInside(root, '/assets/..%2f..%2fsecret.txt')).toBeNull();
    expect(resolveInside(root, '/..%5c..%5csecret.txt')).toBeNull();
    expect(resolveInside(root, '/%E0%A4%A')).toBeNull();
  });
});
