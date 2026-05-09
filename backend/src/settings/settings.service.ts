import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get() {
    let settings = await this.prisma.appSettings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      settings = await this.prisma.appSettings.create({ data: { id: 'default' } });
    }
    return settings;
  }

  async update(data: any) {
    const { id, ...rest } = data;
    return this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...rest },
      update: rest,
    });
  }
}
