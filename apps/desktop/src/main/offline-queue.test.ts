import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OfflineQueue } from './offline-queue';

describe('OfflineQueue', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'offline-queue-'));
    file = join(dir, 'offline-activity.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps at most one moment per minute', () => {
    const q = new OfflineQueue(file);
    q.add('u1', new Date('2026-10-08T08:30:05Z'));
    q.add('u1', new Date('2026-10-08T08:30:45Z'));
    q.add('u1', new Date('2026-10-08T08:31:10Z'));
    expect(q.pending('u1')).toEqual(['2026-10-08T08:30:05.000Z', '2026-10-08T08:31:10.000Z']);
  });

  it('survives an app restart', () => {
    new OfflineQueue(file).add('u1', new Date('2026-10-08T08:30:00Z'));
    expect(new OfflineQueue(file).pending('u1')).toEqual(['2026-10-08T08:30:00.000Z']);
  });

  it("never hands one user's activity to another", () => {
    new OfflineQueue(file).add('u1', new Date('2026-10-08T08:30:00Z'));
    const q = new OfflineQueue(file);
    expect(q.pending('u2')).toEqual([]);
    // ...and u1's entries are gone, not merely hidden.
    expect(q.pending('u1')).toEqual([]);
  });

  it('removes only what was delivered', () => {
    const q = new OfflineQueue(file);
    q.add('u1', new Date('2026-10-08T08:30:00Z'));
    const batch = [...q.pending('u1')];
    q.add('u1', new Date('2026-10-08T08:31:00Z')); // arrived while the batch was in flight
    q.remove(batch);
    expect(q.pending('u1')).toEqual(['2026-10-08T08:31:00.000Z']);
  });
});
