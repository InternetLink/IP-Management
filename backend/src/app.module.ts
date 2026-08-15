import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PrefixesModule } from './prefixes/prefixes.module';
import { GeofeedModule } from './geofeed/geofeed.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { RequestContextMiddleware } from './lib/request-context.middleware';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PrefixesModule,
    GeofeedModule,
    AuditModule,
    SettingsModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
