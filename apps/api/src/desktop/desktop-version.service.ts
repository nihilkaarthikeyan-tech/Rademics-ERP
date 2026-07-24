import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

interface FeedInfo {
  version: string | null;
  publishedAt: Date | null;
}

/** Grace window: an outdated desktop app keeps working this long after a newer
 *  version is published, then login/check-in are refused until it updates.
 *  The app auto-updates within ~4h of publish, so only apps that CAN'T update
 *  (pre-updater installs) or machines kept offline ever actually hit the block. */
const GRACE_MS = 24 * 60 * 60 * 1000;
const FEED_CACHE_MS = 10 * 60 * 1000;

/**
 * Minimum-version enforcement for the desktop app (2026-07-24 decision: "if the
 * person uses the old app for more than 1 day they must get blocked"). Only
 * applies to requests carrying the desktop app key — the website is never
 * affected. Fails OPEN: if the feed is unreachable or has no publishedAt yet
 * (pre-enforcement publishes), nobody is blocked.
 */
@Injectable()
export class DesktopVersionService {
  private readonly logger = new Logger(DesktopVersionService.name);
  private cached: FeedInfo = { version: null, publishedAt: null };
  private cachedAt = 0;

  constructor(private readonly config: ConfigService) {}

  /** Throws 403 when a trusted desktop client is outdated past the grace window. */
  async assertSupported(req: Request): Promise<void> {
    const expectedKey = this.config.get<string>('DESKTOP_APP_KEY');
    const providedKey = req.headers['x-rademics-desktop'];
    if (!expectedKey || providedKey !== expectedKey) return; // not the desktop app

    const feed = await this.feedInfo();
    if (!feed.version || !feed.publishedAt) return; // nothing published / pre-enforcement feed
    if (Date.now() - feed.publishedAt.getTime() < GRACE_MS) return; // inside the 1-day grace

    const clientVersion = (req.headers['x-rademics-desktop-version'] as string | undefined) ?? '0.0.0';
    if (compareVersions(clientVersion, feed.version) < 0) {
      throw new ForbiddenException(
        `This app version is outdated. Please download the latest version from the ERP website (sidebar > Desktop Agent).`,
      );
    }
  }

  private async feedInfo(): Promise<FeedInfo> {
    if (Date.now() - this.cachedAt < FEED_CACHE_MS) return this.cached;
    const feedUrl = this.config.get<string>(
      'DESKTOP_UPDATE_FEED_URL',
      'https://api.52digit.com/desktop-updates',
    );
    try {
      const res = await fetch(`${feedUrl}/version.json`);
      if (res.ok) {
        const data = (await res.json()) as { version?: string; publishedAt?: string };
        const publishedAt = data.publishedAt ? new Date(data.publishedAt) : null;
        this.cached = {
          version: data.version ?? null,
          publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        };
      }
    } catch (err) {
      this.logger.warn(`Desktop feed unreachable, version enforcement skipped: ${(err as Error).message}`);
    }
    this.cachedAt = Date.now();
    return this.cached;
  }
}

/** '0.2.5' vs '0.2.10' → -1/0/1, numeric per segment. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
