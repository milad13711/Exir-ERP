import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { SecurityEventsService } from '../../security/security-events.service.js';
import { clientIp } from '../../security/client-ip.js';

/**
 * Every unhandled error in the API passes through here exactly once, so it
 * is both returned to the client in a consistent shape AND written to the
 * central error log the management team's backoffice reads from. Expected
 * 4xx errors (validation, auth, not-found) are not noise-logged — only
 * server-side failures are.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly events: SecurityEventsService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttp
      ? exception.getResponse()
      : 'خطای داخلی سرور رخ داد. تیم فنی مطلع شد.';

    // مسیر بدون query-string: ?secret=/توکن‌های داخل URL نه به کلاینت برگردانده می‌شوند و نه در لاگ می‌مانند.
    const safePath = (req.originalUrl ?? '').split('?')[0];
    const requestId = (req as Request & { requestId?: string }).requestId;

    if (status === 403 && req.ctx) {
      this.events.record({
        type: 'PERMISSION_DENIED',
        severity: 'INFO',
        tenantId: req.ctx.tenantId,
        actor: req.ctx.auth.sub,
        ip: clientIp(req),
        message: `403 ${req.method} ${safePath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`,
        dedupeKey: `${req.ctx.auth.sub}:${req.method}:${safePath}`,
      });
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(err.message, err.stack);
      try {
        await this.controlDb.errorLog.create({
          data: {
            tenantId: req.ctx?.tenantId,
            service: 'backend-core',
            level: 'ERROR',
            message: err.message,
            stackTrace: err.stack,
            context: { path: safePath, method: req.method, requestId },
          },
        });
      } catch (logErr) {
        // Never let logging failure hide the original error from the client.
        this.logger.error('failed to persist error log', logErr as Error);
      }
    }

    res.status(status).json({
      statusCode: status,
      path: safePath,
      ...(requestId ? { requestId } : {}),
      message: typeof message === 'string' ? message : (message as { message?: string }).message,
    });
  }
}
