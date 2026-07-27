import { describe, expect, it } from 'vitest';
import { formatProjectCode, parseProjectCode } from './project-code.js';

describe('formatProjectCode', () => {
  it('pads to three digits', () => {
    expect(formatProjectCode(1)).toBe('RAD-001');
    expect(formatProjectCode(42)).toBe('RAD-042');
    expect(formatProjectCode(999)).toBe('RAD-999');
  });

  it('grows past the padding rather than truncating', () => {
    expect(formatProjectCode(1000)).toBe('RAD-1000');
    expect(formatProjectCode(123456)).toBe('RAD-123456');
  });
});

describe('parseProjectCode', () => {
  it('accepts the canonical form', () => {
    expect(parseProjectCode('RAD-001')).toBe(1);
    expect(parseProjectCode('RAD-042')).toBe(42);
  });

  it('accepts what people actually type', () => {
    for (const input of ['rad-7', 'RAD 7', 'RAD7', '7', ' RAD-0007 ', 'Rad-007']) {
      expect(parseProjectCode(input)).toBe(7);
    }
  });

  it('rejects anything that is not a clean number', () => {
    for (const input of ['', '   ', 'RAD-', 'RAD-abc', '7abc', 'abc', '-7', '7.5', 'RAD-1-2']) {
      expect(parseProjectCode(input)).toBeNull();
    }
  });

  it('rejects zero and negatives — numbering starts at 1', () => {
    expect(parseProjectCode('0')).toBeNull();
    expect(parseProjectCode('RAD-000')).toBeNull();
  });

  it('round-trips with formatProjectCode', () => {
    for (const n of [1, 9, 10, 99, 100, 999, 1000, 54321]) {
      expect(parseProjectCode(formatProjectCode(n))).toBe(n);
    }
  });
});
