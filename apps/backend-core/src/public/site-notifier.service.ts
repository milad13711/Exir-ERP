import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service.js';

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * ایمیل اطلاع‌رسانی به تیم برای فرم‌های عمومی سایت (نمایندگی، درخواست مشاوره/قالب).
 * گیرنده: SITE_NOTIFY_EMAIL (پیش‌فرض همان EMAIL_SMTP_USER). اگر SMTP تنظیم نباشد یا
 * ارسال شکست بخورد، ثبت فرم هرگز خطا نمی‌دهد — فقط لاگ می‌شود.
 */
@Injectable()
export class SiteNotifierService {
  private readonly logger = new Logger('SiteNotifier');

  constructor(private readonly email: EmailService) {}

  async notify(subject: string, fields: Record<string, string | number | null | undefined>): Promise<void> {
    if (!this.email.isConfigured()) return;
    const to = process.env.SITE_NOTIFY_EMAIL || process.env.EMAIL_SMTP_USER;
    if (!to) return;
    const rows = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `<tr><td style="padding:4px 10px;color:#64748b">${esc(k)}</td><td style="padding:4px 10px">${esc(String(v))}</td></tr>`)
      .join('');
    const result = await this.email.sendEmail(to, subject, `<div dir="rtl" style="font-family:Tahoma,sans-serif"><h3>${esc(subject)}</h3><table>${rows}</table></div>`);
    if (!result.success) this.logger.warn(result.error);
  }
}
