import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { PrefixesService } from './prefixes.service';
import { BulkUpdateAllocationsDto, CreatePrefixDto, UpdatePrefixDto, SplitPrefixDto, UpdateAllocationDto } from './prefixes.dto';

@Controller('prefixes')
export class PrefixesController {
  constructor(private service: PrefixesService) {}

  @Get()
  findRoots() {
    return this.service.findRoots();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/tree')
  getTree(@Param('id') id: string) {
    return this.service.getTree(id);
  }

  @Get(':id/allocations')
  getAllocations(@Param('id') id: string, @Query('status') status?: string) {
    return this.service.getAllocations(id, status);
  }

  @Post()
  create(@Body() dto: CreatePrefixDto) {
    return this.service.create(dto);
  }

  @Post(':id/split')
  split(@Param('id') id: string, @Body() dto: SplitPrefixDto) {
    return this.service.split(id, dto);
  }

  @Post(':id/generate-ips')
  generateIPs(@Param('id') id: string) {
    return this.service.generateIPs(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePrefixDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/allocations/:allocId')
  updateAllocation(@Param('id') id: string, @Param('allocId') allocId: string, @Body() data: UpdateAllocationDto) {
    return this.service.updateAllocation(id, allocId, data);
  }

  @Put(':id/allocations')
  bulkUpdateAllocations(@Param('id') id: string, @Body() data: BulkUpdateAllocationsDto) {
    return this.service.bulkUpdateAllocations(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
