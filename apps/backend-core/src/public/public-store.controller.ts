import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicStoreService } from './public-store.service.js';
import { CreateStoreOrderDto } from './dto/create-store-order.dto.js';
import { TrackStoreEventDto } from './dto/track-store-event.dto.js';

@Controller('public/store/:slug')
export class PublicStoreController {
  constructor(private readonly store: PublicStoreService) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.store.storeInfo(slug);
  }

  @Get('products')
  products(@Param('slug') slug: string) {
    return this.store.listProducts(slug);
  }

  @Get('products/:productSlug')
  product(@Param('slug') slug: string, @Param('productSlug') productSlug: string) {
    return this.store.getProduct(slug, productSlug);
  }

  @Post('track')
  track(@Param('slug') slug: string, @Body() dto: TrackStoreEventDto) {
    return this.store.track(slug, dto);
  }

  @Post('orders')
  placeOrder(@Param('slug') slug: string, @Body() dto: CreateStoreOrderDto) {
    return this.store.placeOrder(slug, dto);
  }

  /**
   * تصاویر کالا به‌صورت data URI در دیتابیس ذخیره می‌شوند (بدون فضای ذخیره‌سازی
   * فایل جداگانه)؛ خزنده‌های og:image اینستاگرام/متا لینک data: را نمی‌پذیرند
   * و به یک URL واقعی نیاز دارند — این مسیر همان بایت‌ها را با Content-Type
   * درست پخش می‌کند تا هم og:image و هم تگ‌های <img> صفحه یک URL واقعی داشته باشند.
   */
  @Get('products/:productSlug/image/:index')
  async productImage(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    const dataUri = await this.store.getProductImage(slug, productSlug, index);
    if (!dataUri) throw new NotFoundException('تصویر یافت نشد');
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if (!match) throw new NotFoundException('تصویر یافت نشد');
    const [, mimeType, base64] = match;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(base64, 'base64'));
  }

  @Get('feed.csv')
  async feed(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const baseUrl = (process.env.WEB_PANEL_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const csv = await this.store.productFeedCsv(slug, baseUrl);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${slug}-products.csv"`);
    res.send(csv);
  }
}
