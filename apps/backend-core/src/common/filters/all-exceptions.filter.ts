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

  constructor(private readonly controlDb: ControlPrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttp
      ? exception.getResponse()
      : 'خطای داخلی سرور رخ داد. تیم فنی مطلع شد.';

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
            context: { path: req.originalUrl, method: req.method },
          },
        });
      } catch (logErr) {
        // Never let logging failure hide the original error from the client.
        this.logger.error('failed to persist error log', logErr as Error);
      }
    }

    res.status(status).json({
      statusCode: status,
      path: req.originalUrl,
      message: typeof message === 'string' ? message : (message as { message?: string }).message,
    });
  }
}
