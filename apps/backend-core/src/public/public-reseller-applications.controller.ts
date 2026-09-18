import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PublicResellerMapService } from './public-reseller-map.service.js';
import { CreateResellerApplicationDto } from './dto/create-reseller-application.dto.js';

/**
 * صفحه‌ی «همکاری با ما» در eta.co.ir — فرم عمومی درخواست نمایندگی
 * (بدون OTP، مثل public/catalog/lead) و داده‌ی نقشه‌ی نمایندگان احرازشده.
 */
@Controller('public')
export class PublicResellerApplicationsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly map: PublicResellerMapService,
  ) {}

  @Post('reseller-applications')
  createApplication(@Body() dto: CreateResellerApplicationDto) {
    return this.controlDb.resellerApplication.create({
      data: {
        name: dto.name,
        company: dto.company,
        phone: dto.phone,
        email: dto.email,
        city: dto.city,
        websiteUrl: dto.websiteUrl,
        productCode: dto.productCode,
        message: dto.message,
      },
    });
  }

  @Get('resellers/map')
  listMap(@Query('productCode') productCode: string | undefined) {
    return this.map.listForMap(productCode);
  }
}
