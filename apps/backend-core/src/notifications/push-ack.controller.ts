import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { SlidingRateLimiter } from './push-logic.js';
import { clientIp } from '../security/client-ip.js';

const ackLimiter = new SlidingRateLimiter(120, 60_000);
const rotateLimiter = new SlidingRateLimiter(20, 60_000);

/**
 * نقاط پایانیِ عمومی (بدون JWT) که فقط سرویس‌ورکر صدا می‌زند. امنیت = توکن HMAC امضاشده؛
 * همیشه ۲۰۴ برمی‌گردانند (چه توکن معتبر باشد چه نه) تا اوراکلی برای حدس‌زدن نباشد؛ با سقف نرخ به‌ازای IP.
 */
@Controller('push')
export class PushAckController {
  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly push: PushNotificationsService,
  ) {}

  @Post('ack')
  @HttpCode(204)
  async ack(@Body() body: { t?: unknown }, @Req() req: Request): Promise<void> {
    if (!ackLimiter.allow(clientIp(req))) return;
    await this.delivery.ackByToken(body?.t);
  }

  /** چرخش اشتراک (pushsubscriptionchange) وقتی سرویس‌ورکر توکن ورود ندارد: توکن دستگاه که هنگام ثبت اشتراک صادر شده بود. */
  @Post('rotate')
  @HttpCode(200)
  async rotate(@Body() body: { t?: unknown; endpoint?: unknown; p256dh?: unknown; auth?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ t: string } | undefined> {
    const ip = clientIp(req);
    // موفق: ۲۰۰ + توکن بعدی (زنجیره‌ی یک‌بارمصرف). هر شکست/محدودیت: ۲۰۴ بدون بدنه.
    const next = rotateLimiter.allow(ip) ? await this.push.rotateByToken(body?.t, body?.endpoint, body?.p256dh, body?.auth, ip) : null;
    if (next) return { t: next };
    res.status(204);
    return undefined;
  }
}
