import { Module } from '@nestjs/common';
import { GeofeedController } from './geofeed.controller';
import { GeofeedService } from './geofeed.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [GeofeedController],
  providers: [GeofeedService],
  exports: [GeofeedService],
})
export class GeofeedModule {}
