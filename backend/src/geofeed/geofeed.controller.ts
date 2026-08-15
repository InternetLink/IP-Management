import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Public } from '../auth/public.decorator';
import { CreateGeofeedDto, GenerateGeofeedQueryDto, ImportGeofeedDto, ListGeofeedQueryDto, UpdateGeofeedDto } from './geofeed.dto';
import { GeofeedService } from './geofeed.service';

type CsvResponse = NodeJS.WritableStream & {
  setHeader(name: string, value: string): void;
};

@Controller('geofeed')
export class GeofeedController {
  constructor(private service: GeofeedService) {}

  @Get()
  findAll(@Query() query: ListGeofeedQueryDto) {
    return this.service.findAll(query);
  }

  @Public()
  @Get('generate')
  async generate(@Res() res: CsvResponse, @Query() query: GenerateGeofeedQueryDto) {
    const csv = this.service.generateCSV(query.header, query.asn);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="geofeed.csv"');
    await pipeline(Readable.from(csv), res);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateGeofeedDto) { return this.service.create(dto); }

  @Post('import')
  importCSV(@Body() dto: ImportGeofeedDto) { return this.service.importCSV(dto.csv); }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGeofeedDto) { return this.service.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
