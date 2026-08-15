import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { CapacityBackfillWorker, CapacityReadinessError } from '../prefixes/capacity-backfill';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const readMode = process.env.CAPACITY_READ_MODE ?? 'dual';
      if (readMode === 'exact') {
        await new CapacityBackfillWorker(this.prisma).assertExactCapacityReady();
      } else if (readMode !== 'dual') {
        throw new ServiceUnavailableException(`Unsupported CAPACITY_READ_MODE: ${readMode}`);
      }
      return { status: 'ok' };
    } catch (error) {
      if (error instanceof CapacityReadinessError) {
        throw new ServiceUnavailableException('Exact capacity is not ready');
      }
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof Error) {
        throw new ServiceUnavailableException('DB unavailable');
      }
      throw new ServiceUnavailableException('DB unavailable');
    }
  }
}
