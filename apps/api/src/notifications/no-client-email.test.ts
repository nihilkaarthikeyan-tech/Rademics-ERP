import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

/**
 * Clients are never emailed (2026-07-27).
 *
 * Everything the company says to a client is read in the portal. The rule lives
 * inside notify() rather than at each call site so it survives code nobody has
 * written yet — these cases pin that, because a single forgotten flag on some
 * future notification would silently break a promise made to the client.
 *
 * Account mail (invite, password reset) does not pass through notify() at all;
 * AuthService sends it directly, and without it nobody could reach the portal.
 */
function makeService(role: string) {
  const email = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) }, // no pref → default IN_APP_EMAIL
    notification: { create: vi.fn().mockResolvedValue({ id: 'n1', createdAt: new Date() }) },
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'someone@example.com', role }) },
  };
  const presence = { emitToUser: vi.fn() };
  const service = new NotificationsService(prisma as never, email as never, presence as never);
  return { service, email, prisma };
}

const base = { userId: 'u1', type: 'ANYTHING', eventGroup: 'tasks', title: 'A thing happened' };

describe('notify — clients are never emailed', () => {
  it('does not email a CLIENT even on the default preference', async () => {
    const { service, email } = makeService('CLIENT');
    await service.notify(base);
    expect(email.enqueue).not.toHaveBeenCalled();
  });

  it('still writes the in-app row for a CLIENT — they read it in the portal', async () => {
    const { service, prisma } = makeService('CLIENT');
    await service.notify(base);
    expect(prisma.notification.create).toHaveBeenCalledOnce();
  });

  it('does email staff, so the rule is about clients and not a blanket mute', async () => {
    const { service, email } = makeService('EMPLOYEE');
    await service.notify(base);
    expect(email.enqueue).toHaveBeenCalledOnce();
  });

  it('honours an explicit IN_APP channel for staff too', async () => {
    const { service, email } = makeService('EMPLOYEE');
    await service.notify({ ...base, channel: 'IN_APP' });
    expect(email.enqueue).not.toHaveBeenCalled();
  });
});
