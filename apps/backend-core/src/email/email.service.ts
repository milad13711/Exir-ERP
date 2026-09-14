import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export type SendEmailResult = { success: true } | { success: false; error: string };

/**
 * Thin SMTP client, configured via EMAIL_SMTP_HOST/PORT/USER/PASS/FROM.
 * Mirrors ExirSmsService's shape deliberately: isConfigured() lets callers
 * (NotificationsService) skip the email channel silently rather than fail
 * when no SMTP account has been set up yet, exactly like OTP_DEV_ECHO does
 * for SMS.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.EMAIL_SMTP_HOST && process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASS);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: Number(process.env.EMAIL_SMTP_PORT ?? 587),
        secure: process.env.EMAIL_SMTP_SECURE === 'true',
        auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS },
      });
    }
    return this.transporter;
  }

  async sendEmail(to: string, subject: string, html: string, options?: { cc?: string | string[] }): Promise<SendEmailResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'سرویس ایمیل پیکربندی نشده است (EMAIL_SMTP_HOST/USER/PASS)' };
    }
    try {
      await this.getTransporter().sendMail({
        from: process.env.EMAIL_SMTP_FROM || process.env.EMAIL_SMTP_USER,
        to,
        cc: options?.cc,
        subject,
        html,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطای ناشناخته';
      this.logger.error(`Email send failed: ${message}`);
      return { success: false, error: `ارسال ایمیل ناموفق بود: ${message}` };
    }
  }
}
