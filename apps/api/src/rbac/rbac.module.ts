import { Global, Module } from '@nestjs/common';
import { CapabilityService } from './capability.service';

@Global()
@Module({
  providers: [CapabilityService],
  exports: [CapabilityService],
})
export class RbacModule {}
