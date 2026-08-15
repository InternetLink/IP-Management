import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './settings.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  get() { return this.service.get(); }

  @Put()
  @Roles('admin')
  update(@Body() dto: UpdateSettingsDto) { return this.service.update(dto); }
}
