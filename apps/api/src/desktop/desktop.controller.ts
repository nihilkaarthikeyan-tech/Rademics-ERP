import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DesktopVersionInfo {
  version: string | null;
  downloadUrl: string | null;
}

/**
 * Lets a logged-in employee self-download the desktop agent from the website —
 * the same install that already-running apps auto-update from (2026-07-24).
 * Reads the small `version.json` the publish workflow writes alongside the
 * installer (.github/workflows/desktop-installer.yml, publish=true) — if
 * nothing has been published yet, returns nulls so the UI just hides the
 * download prompt instead of erroring.
 */
@Controller('desktop')
export class DesktopController {
  private readonly logger = new Logger(DesktopController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('version')
  async version(): Promise<DesktopVersionInfo> {
    const feedUrl = this.config.get<string>(
      'DESKTOP_UPDATE_FEED_URL',
      'https://api.52digit.com/desktop-updates',
    );
    try {
      const res = await fetch(`${feedUrl}/version.json`);
      if (!res.ok) return { version: null, downloadUrl: null };
      const data = (await res.json()) as { version?: string };
      if (!data.version) return { version: null, downloadUrl: null };
      return { version: data.version, downloadUrl: `${feedUrl}/ERP-Agent-Setup.exe` };
    } catch (err) {
      this.logger.warn(`Could not reach the desktop update feed: ${(err as Error).message}`);
      return { version: null, downloadUrl: null };
    }
  }
}
