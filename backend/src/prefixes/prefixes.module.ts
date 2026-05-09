import { Module } from '@nestjs/common';
import { PrefixesService } from './prefixes.service';
import { PrefixesController } from './prefixes.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PrefixesController],
  providers: [PrefixesService],
  exports: [PrefixesService],
})
export class PrefixesModule {}
