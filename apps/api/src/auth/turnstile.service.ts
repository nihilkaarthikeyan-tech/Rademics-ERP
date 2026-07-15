import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile CAPTCHA verification (Spec §10 bot protection). Same
 * DSN-guarded pattern as Sentry (instrument.ts): a safe no-op until a real secret
 * key is configured, so it can ship without breaking login before Turnstile is set up.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(token: string | undefined, ip: string | null | undefined): Promise<void> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY', '');
    if (!secret) return; // not configured yet — no-op

    if (!token) throw new BadRequestException('Captcha verification required');

    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set('remoteip', ip);

      const res = await fetch(VERIFY_URL, { method: 'POST', body });
      const data = (await res.json()) as { success: boolean };
      if (!data.success) throw new BadRequestException('Captcha verification failed');
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Network/Cloudflare outage: log it, but don't lock everyone out of login (Spec §11).
      this.logger.error(`Turnstile verify request failed: ${(err as Error).message}`);
    }
  }
}
