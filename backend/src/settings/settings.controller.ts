import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  get() { return this.service.get(); }

  @Put()
  update(@Body() data: any) { return this.service.update(data); }
}
