import { Controller, Get, Post, Put, Delete, Param, Body, Query, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { GeofeedService } from './geofeed.service';
import { CreateGeofeedDto, UpdateGeofeedDto, ImportGeofeedDto } from './geofeed.dto';

@Controller('geofeed')
export class GeofeedController {
  constructor(private service: GeofeedService) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('countryCode') countryCode?: string) {
    return this.service.findAll({ search, countryCode });
  }

  @Get('generate')
  async generate(@Res() res: Response, @Query('header') header?: string, @Query('asn') asn?: string) {
    const csv = await this.service.generateCSV(header, asn);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="geofeed.csv"');
    res.send(csv);
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
