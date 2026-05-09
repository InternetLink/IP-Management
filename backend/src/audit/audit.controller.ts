import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private service: AuditService) {}

  @Get()
  findAll(@Query('action') action?: string, @Query('resourceType') resourceType?: string, @Query('search') search?: string, @Query('limit') limit?: string) {
    return this.service.findAll({ action, resourceType, search, limit: limit ? parseInt(limit) : undefined });
  }
}
