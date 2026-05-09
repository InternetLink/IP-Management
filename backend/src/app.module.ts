import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PrefixesModule } from './prefixes/prefixes.module';
import { GeofeedModule } from './geofeed/geofeed.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PrefixesModule,
    GeofeedModule,
    AuditModule,
    SettingsModule,
    DashboardModule,
  ],
})
export class AppModule {}
