import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

// A few monetary columns (CrmDeal.value, JournalLine.debit/credit) are
// BigInt in Postgres/Prisma so a single deal or entry can exceed 2.1B
// Toman (Postgres INT4's limit — hit for real in production). JSON has no
// BigInt type, so Express's res.json() throws on one without this: convert
// to a plain number at serialization time. Safe — Toman amounts never get
// remotely close to Number.MAX_SAFE_INTEGER (~9 quadrillion).
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    // `|| ` (not `??`) so an accidentally-empty CORS_ORIGINS in .env (e.g.
    // `CORS_ORIGINS=` with nothing after it) falls back too, instead of
    // resolving to `['']` and rejecting every origin.
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('اکسیر ERP — REST API')
      .setDescription(
        'دسترسی برنامه‌نویسی به داده‌های تننت شما. برای احراز هویت، یک کلید API از Settings → API بسازید و آن را به‌صورت `Authorization: Bearer exir_live_...` ارسال کنید.',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'کلید API (exir_live_...) یا توکن ورود کاربر' })
      .build(),
  );
  // SwaggerModule.setup ignores setGlobalPrefix — mounted at "api/docs"
  // explicitly (not just "docs") so it's reachable through the on-premise
  // nginx proxy, which only forwards /api/* to this backend (see
  // infra/on-premise/nginx.conf) and everything else to the web panel.
  SwaggerModule.setup('api/docs', app, swaggerDoc, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
