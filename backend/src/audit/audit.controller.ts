import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './audit.dto';

@Controller('audit')
export class AuditController {
  constructor(private service: AuditService) {}

  @Get()
  findAll(@Query() dto: AuditQueryDto) {
    return this.service.findAll(dto);
  }
}
