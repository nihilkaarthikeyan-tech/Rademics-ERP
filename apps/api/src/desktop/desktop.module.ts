import { Global, Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';
import { DesktopVersionService } from './desktop-version.service';

/** @Global so auth (login) and attendance (check-in) can enforce the desktop
 *  minimum-version rule without import ceremony. */
@Global()
@Module({
  controllers: [DesktopController],
  providers: [DesktopVersionService],
  exports: [DesktopVersionService],
})
export class DesktopModule {}
