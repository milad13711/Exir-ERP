import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicBookStoreService } from './public-book-store.service.js';
import { RequestBookOtpDto } from './dto/request-book-otp.dto.js';
import { VerifyBookOtpDto } from './dto/verify-book-otp.dto.js';
import { CreatePublicBookOrderDto } from './dto/create-public-book-order.dto.js';

@Controller('public/book/:slug')
export class PublicBookStoreController {
  constructor(private readonly bookStore: PublicBookStoreService) {}

  @Get('catalog')
  catalog() {
    return this.bookStore.getCatalog();
  }

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestBookOtpDto) {
    return this.bookStore.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyBookOtpDto) {
    return this.bookStore.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post('orders')
  createOrder(@Param('slug') slug: string, @Body() dto: CreatePublicBookOrderDto) {
    return this.bookStore.createOrder(slug, dto);
  }

  @Get('orders/:orderId/status')
  orderStatus(@Param('slug') slug: string, @Param('orderId') orderId: string) {
    return this.bookStore.getOrderStatus(slug, orderId);
  }
}
